// src/app/api/users/route.ts
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: '인증되지 않은 사용자입니다.' }, { status: 401 });
    }

    // 인증서(공개키)가 등록된 사용자 목록 조회
    const users = await prisma.user.findMany({
      where: {
        certificate: { not: null },
      },
      select: {
        email: true,
        name: true,
        publicKey: true, // 수신자의 공개키 필요
      },
    });

    return NextResponse.json(users);
  } catch (error) {
    console.error('사용자 목록 조회 에러:', error);
    return NextResponse.json({ error: '사용자 목록을 가져오는 중 에러가 발생했습니다.' }, { status: 500 });
  }
}
