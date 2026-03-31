import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

export const { handlers, auth, signIn, signOut } = NextAuth({
  debug: true,
  secret: process.env.AUTH_SECRET,
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID as string,
      clientSecret: process.env.AUTH_GITHUB_SECRET as string,
    })
  ],
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false;
      try {
        await prisma.user.upsert({
          where: { email: user.email },
          update: { name: user.name, image: user.image },
          create: { email: user.email, name: user.name, image: user.image },
        });
        return true;
      } catch (error) {
        console.error("❌ DB 저장 에러:", error);
        return false;
      }
    },
  },
})