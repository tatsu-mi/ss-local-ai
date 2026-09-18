import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { ensureAppUser } from "@/lib/users";

type EntraProfile = {
  sub?: string;
  tid?: string;
  name?: string;
  email?: unknown;
  preferred_username?: string;
};

const entraIssuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER?.replace(/\/+$/, "");

function getEmployeeEmail(profile: Pick<EntraProfile, "email" | "preferred_username">) {
  const value = typeof profile.email === "string" ? profile.email : profile.preferred_username;
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.includes("@") ? email : null;
}

function getConfiguredTenantId() {
  return entraIssuer
    ?.match(/^https:\/\/login\.microsoftonline\.com\/([0-9a-f-]{36})\/v2\.0$/i)?.[1]
    ?.toLowerCase() ?? null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  cookies: {
    sessionToken: { name: "ss-local-ai.session-token" },
  },
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: entraIssuer,
      authorization: { params: { scope: "openid profile email" } },
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name,
          email: getEmployeeEmail(profile),
          image: null,
        };
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ profile }) {
      const entra = profile as EntraProfile;
      const tenantId = getConfiguredTenantId();
      return Boolean(
        tenantId && entra.tid?.toLowerCase() === tenantId && getEmployeeEmail(entra),
      );
    },
    async jwt({ token, profile }) {
      if (profile) {
        const entra = profile as EntraProfile;
        const tenantId = getConfiguredTenantId();
        const email = getEmployeeEmail(entra);
        if (!tenantId || entra.tid?.toLowerCase() !== tenantId || !email) {
          throw new Error("Invalid Entra tenant or identity claims");
        }
        token.appUserId = await ensureAppUser({
          email,
          displayName: entra.name?.trim() || email,
        });
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.appUserId === "string") {
        session.user.appUserId = token.appUserId;
      }
      return session;
    },
  },
});
