import makeWASocket, {
  BufferJSON,
  DisconnectReason,
  fetchLatestBaileysVersion,
  initAuthCreds,
  proto,
  type AuthenticationState,
  type SignalDataTypeMap,
  type WASocket,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { Prisma } from "@prisma/client";
import { systemDb } from "../db.js";
import { AppError } from "../errors.js";
import { logger } from "../logger.js";
import { enqueueInbound } from "../queues.js";
import { decryptJson, encryptJson } from "../security.js";
const enc = (v: unknown) => encryptJson(JSON.stringify(v, BufferJSON.replacer));
const dec = <T>(v: string) =>
  JSON.parse(decryptJson<string>(v), BufferJSON.reviver) as T;
export async function createBaileysChannel(storeId: string, name: string) {
  return systemDb.$transaction(async (tx) => {
    const channel = await tx.channel.create({
        data: {
          storeId,
          type: "WHATSAPP_BAILEYS",
          name,
          externalAccountId: `session:${crypto.randomUUID()}`,
          credentialsEncrypted: encryptJson({ mode: "baileys" }),
          status: "PENDING",
        },
      }),
      session = await tx.whatsAppSession.create({
        data: {
          storeId,
          channelId: channel.id,
          credentialsEnc: enc(initAuthCreds()),
          status: "PENDING",
        },
      });
    return { channel, session };
  });
}
async function state(channelId: string) {
  const s = await systemDb.whatsAppSession.findUniqueOrThrow({
      where: { channelId },
    }),
    creds = dec<AuthenticationState["creds"]>(s.credentialsEnc),
    auth: AuthenticationState = {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[],
        ) => {
          const rows = await systemDb.whatsAppAuthKey.findMany({
              where: { sessionId: s.id, category: type, keyId: { in: ids } },
            }),
            out: { [id: string]: SignalDataTypeMap[T] } = {};
          for (const r of rows) {
            let v = dec<SignalDataTypeMap[T]>(r.valueEnc);
            if (type === "app-state-sync-key" && v)
              v = proto.Message.AppStateSyncKeyData.fromObject(
                v as any,
              ) as unknown as SignalDataTypeMap[T];
            out[r.keyId] = v;
          }
          return out;
        },
        set: async (data) =>
          systemDb.$transaction(async (tx) => {
            for (const category of Object.keys(data) as Array<
              keyof SignalDataTypeMap
            >) {
              const entries = data[category];
              if (!entries) continue;
              for (const [keyId, v] of Object.entries(entries))
                v == null
                  ? await tx.whatsAppAuthKey.deleteMany({
                      where: { sessionId: s.id, category, keyId },
                    })
                  : await tx.whatsAppAuthKey.upsert({
                      where: {
                        sessionId_category_keyId: {
                          sessionId: s.id,
                          category,
                          keyId,
                        },
                      },
                      update: { valueEnc: enc(v) },
                      create: {
                        storeId: s.storeId,
                        sessionId: s.id,
                        category,
                        keyId,
                        valueEnc: enc(v),
                      },
                    });
            }
          }),
      },
    };
  return {
    auth,
    storeId: s.storeId,
    save: () =>
      systemDb.whatsAppSession.update({
        where: { id: s.id },
        data: { credentialsEnc: enc(auth.creds) },
      }),
  };
}
const jid = (v: string) =>
  v.includes("@")
    ? v.replace(/:\d+@/, "@")
    : `${v.replace(/\D/g, "")}@s.whatsapp.net`;
const msg = (m: any) =>
  String(
    m?.message?.conversation ??
      m?.message?.extendedTextMessage?.text ??
      m?.message?.imageMessage?.caption ??
      m?.message?.videoMessage?.caption ??
      "",
  );
export class BaileysManager {
  private sockets = new Map<string, WASocket>();
  private timers = new Map<string, NodeJS.Timeout>();
  private stops = new Set<string>();
  async start(channelId: string) {
    if (this.sockets.has(channelId)) return;
    this.stops.delete(channelId);
    const channel = await systemDb.channel.findUnique({
      where: { id: channelId },
      include: { whatsappSession: true },
    });
    if (!channel || !channel.whatsappSession) return;
    const { auth, storeId, save } = await state(channelId),
      { version } = await fetchLatestBaileysVersion(),
      socket = makeWASocket({
        version,
        auth,
        logger: logger.child({ channelId }) as any,
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        generateHighQualityLinkPreview: false,
        shouldIgnoreJid: (x) => x.endsWith("@broadcast"),
      });
    this.sockets.set(channelId, socket);
    socket.ev.on("creds.update", () => void save());
    socket.ev.on(
      "connection.update",
      (u) =>
        void (async () => {
          if (u.qr)
            await systemDb.whatsAppSession.update({
              where: { channelId },
              data: {
                qrCodeDataUrl: await QRCode.toDataURL(u.qr, {
                  width: 320,
                  margin: 2,
                }),
                qrExpiresAt: new Date(Date.now() + 55000),
                status: "PENDING",
                lastError: null,
              },
            });
          if (u.connection === "open")
            await systemDb.$transaction([
              systemDb.whatsAppSession.update({
                where: { channelId },
                data: {
                  status: "CONNECTED",
                  qrCodeDataUrl: null,
                  qrExpiresAt: null,
                  phoneJid: socket.user?.id ? jid(socket.user.id) : null,
                  lastSeenAt: new Date(),
                  lastError: null,
                },
              }),
              systemDb.channel.update({
                where: { id: channelId },
                data: {
                  status: "CONNECTED",
                  lastConnectedAt: new Date(),
                  lastError: null,
                },
              }),
            ]);
          if (u.connection === "close") {
            this.sockets.delete(channelId);
            const er = u.lastDisconnect?.error as
                | { output?: { statusCode?: number }; message?: string }
                | undefined,
              logged =
                er?.output?.statusCode === DisconnectReason.loggedOut ||
                this.stops.delete(channelId);
            await systemDb.$transaction([
              systemDb.whatsAppSession.update({
                where: { channelId },
                data: {
                  status: logged ? "DISCONNECTED" : "ERROR",
                  lastError: er?.message ?? "Disconnected",
                },
              }),
              systemDb.channel.update({
                where: { id: channelId },
                data: {
                  status: logged ? "DISCONNECTED" : "ERROR",
                  lastError: er?.message ?? "Disconnected",
                },
              }),
            ]);
            if (!logged) {
              const t = setTimeout(() => {
                this.timers.delete(channelId);
                void this.start(channelId);
              }, 5000);
              this.timers.set(channelId, t);
            }
          }
        })().catch((e) => logger.error({ err: e }, "baileys update")),
    );
    socket.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      void (async () => {
        for (const m of messages) {
          if (m.key.fromMe || !m.key.id || !m.key.remoteJid) continue;
          const text = msg(m).trim();
          if (!text) continue;
          try {
            const e = await systemDb.webhookEvent.create({
              data: {
                provider: "WHATSAPP_BAILEYS",
                eventKey: `${channelId}:${m.key.id}`,
                storeId,
                channelId,
                payload: {
                  externalMessageId: m.key.id,
                  customerExternalId: jid(m.key.remoteJid),
                  customerName: m.pushName,
                  text,
                  timestamp: new Date(
                    Number(m.messageTimestamp ?? Date.now() / 1000) * 1000,
                  ).toISOString(),
                  rawType: "text",
                },
              },
            });
            await enqueueInbound(e.id);
          } catch (e) {
            if (
              e instanceof Prisma.PrismaClientKnownRequestError &&
              e.code === "P2002"
            ) {
              const old = await systemDb.webhookEvent.findUnique({
                where: {
                  provider_eventKey: {
                    provider: "WHATSAPP_BAILEYS",
                    eventKey: `${channelId}:${m.key.id!}`,
                  },
                },
              });
              if (old && old.status !== "COMPLETED" && old.status !== "IGNORED")
                await enqueueInbound(old.id, true);
            } else throw e;
          }
        }
      })();
    });
  }
  async send(channelId: string, to: string, text: string) {
    const s = this.sockets.get(channelId);
    if (!s) {
      await this.start(channelId);
      throw new AppError(503, "WHATSAPP_CONNECTING", "الجلسة تتصل");
    }
    const r = await s.sendMessage(jid(to), { text });
    if (!r?.key.id)
      throw new AppError(502, "WHATSAPP_SEND_FAILED", "فشل WhatsApp");
    return r.key.id;
  }
  async disconnect(id: string) {
    this.stops.add(id);
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
    const s = this.sockets.get(id);
    this.sockets.delete(id);
    if (s) await s.logout().catch(() => s.end(new Error("manual stop")));
    await systemDb.$transaction([
      systemDb.channel.update({
        where: { id },
        data: { status: "DISCONNECTED" },
      }),
      systemDb.whatsAppSession.update({
        where: { channelId: id },
        data: {
          status: "DISCONNECTED",
          qrCodeDataUrl: null,
          qrExpiresAt: null,
        },
      }),
    ]);
  }
  async bootstrap() {
    const cs = await systemDb.channel.findMany({
      where: {
        type: "WHATSAPP_BAILEYS",
        status: { in: ["PENDING", "CONNECTED", "ERROR"] },
      },
      select: { id: true },
    });
    await Promise.allSettled(cs.map((c) => this.start(c.id)));
  }
  async stopAll() {
    for (const t of this.timers.values()) clearTimeout(t);
    for (const s of this.sockets.values()) s.end(undefined);
  }
}
