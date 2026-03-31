// src/app/api/messages/received/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: '인증되지 않은 사용자입니다.' }, { status: 401 });
    }

    // 나에게 온 메시지 목록 조회
    const messages = await prisma.message.findMany({
      where: {
        receiverEmail: session.user.email,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // 각 메시지의 송신자 정보를 추가로 조회하여 상세 정보 구성
    const detailedMessages = await Promise.all(
      messages.map(async (msg) => {
        const sender = await prisma.user.findUnique({
          where: { email: msg.senderEmail },
          select: { name: true, publicKey: true },
        });
        return {
          ...msg,
          senderName: sender?.name || '알 수 없는 사용자',
          senderPublicKey: sender?.publicKey,
        };
      })
    );

    return NextResponse.json(detailedMessages);
  } catch (error) {
    console.error('수신함 조회 에러:', error);
    return NextResponse.json({ error: '수신 정보를 가져오는 중 에러가 발생했습니다.' }, { status: 500 });
  }
}
