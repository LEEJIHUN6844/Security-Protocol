// src/app/api/messages/send/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: '인증되지 않은 사용자입니다.' }, { status: 401 });
    }

    const { receiverEmail, encryptedContent, encryptedKey, iv } = await req.json();

    if (!receiverEmail || !encryptedContent || !encryptedKey || !iv) {
      return NextResponse.json({ error: '필수 데이터가 누락되었습니다.' }, { status: 400 });
    }

    // 전자봉투 메시지 DB 저장
    const message = await prisma.message.create({
      data: {
        senderEmail: session.user.email,
        receiverEmail,
        encryptedContent,
        encryptedKey,
        iv,
      },
    });

    return NextResponse.json({ success: true, messageId: message.id });
  } catch (error) {
    console.error('메시지 전송 에러:', error);
    return NextResponse.json({ error: '메시지를 전송하는 중 서버 에러가 발생했습니다.' }, { status: 500 });
  }
}
