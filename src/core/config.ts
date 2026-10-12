import "dotenv/config";
import env from "env-var";
import { resolveSecret } from "./utils/secrets.js";

export const config = {
  server: {
    port: env.get("PORT").default(12113).asPortNumber(),
    host: env.get("NODE_ENV").asString() === "production" ? "0.0.0.0" : env.get("HOST").default("localhost").asString(),
    environment: env.get("NODE_ENV").default("development").asString(),
    isProduction: env.get("NODE_ENV").default("development").asString() === "production",
    isDevelopment: env.get("NODE_ENV").default("development").asString() !== "production",
  },
  auth: {
    bcryptSaltRounds: env.get("BCRYPT_SALT_ROUNDS").default(10).asIntPositive(),
    jwtSecret: resolveSecret("jwt_secret", "JWT_SECRET"),
    jwtExpiresIn: env.get("JWT_EXPIRES_IN").default("7d").asString(),
  },
  cors: {
    allowedOrigins: env.get("ALLOWED_ORIGINS").default("").asArray(),
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    credentials: true,
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      const allowed = env.get("ALLOWED_ORIGINS").default("").asArray();
      if (!origin) return callback(null, true);
      callback(null, allowed.includes(origin));
    },
  },
  database: {
    supabase: {
      url: env.get("SUPABASE_URL").default("").asString(),
      key: resolveSecret("supabase_key", "SUPABASE_KEY"),
    },
    qdrant: {
      url: env.get("QDRANT_URL").default("http://127.0.0.1:6333").asString().replace(/\/$/, ""),
    },
  },
  email: {
    sendgridApiKey: resolveSecret("sendgrid_api_key", "SENDGRID_API_KEY"),
    senderEmail: env.get("EMAIL_SENDER").default("no-reply@specter.com").asString(),
    senderName: env.get("EMAIL_SENDER_NAME").default("Specter System").asString(),
    testmail: {
      apiKey: resolveSecret("testmail_api_key", "TESTMAIL_API_KEY"),
      namespace: env.get("TESTMAIL_NAMESPACE").default("").asString(),
    },
  },
  google: {
    clientId: env.get("GOOGLE_CLIENT_ID").default("").asString(),
    clientSecret: resolveSecret("google_client_secret", "GOOGLE_CLIENT_SECRET"),
  },
  webrtc: {
    turnKeyId: resolveSecret("cloudflare_turn_key_id", "CLOUDFLARE_TURN_KEY_ID"),
    turnApiToken: resolveSecret("cloudflare_turn_api_token", "CLOUDFLARE_TURN_API_TOKEN"),
    turnUrl: env.get("CLOUDFLARE_TURN_URL").default("turn:turn.cloudflare.com:3478").asString(),
    turnsUrl: env.get("CLOUDFLARE_TURNS_URL").default("turns:turn.cloudflare.com:5349").asString(),
  },
};

export interface RtcIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export function getWebrtcIceServers(): RtcIceServer[] {
  const { turnKeyId, turnApiToken, turnUrl, turnsUrl } = config.webrtc;
  if (turnKeyId && turnApiToken) {
    return [
      {
        urls: ["stun:turn.cloudflare.com:3478", "stun:stun.cloudflare.com:3478"],
      },
      {
        urls: [`${turnUrl}?transport=udp`, `${turnUrl}?transport=tcp`, `${turnsUrl}?transport=tcp`],
        username: turnKeyId,
        credential: turnApiToken,
      },
    ];
  }
  return [
    {
      urls: ["stun:turn.cloudflare.com:3478", "stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"],
    },
  ];
}

export type Config = typeof config;

export default config;
