import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import forge from 'node-forge';

export async function POST(req: Request) {
  try {
    const { email, time, signatureHex } = await req.json();

    if (!email || !time || !signatureHex) {
      return NextResponse.json({ error: '필수 데이터가 누락되었습니다.' }, { status: 400 });
    }

    // 1. 시간 오차 검증 (재전송 공격 방지)
    const clientTime = parseInt(time);
    const serverTime = Date.now();
    const timeDiff = Math.abs(serverTime - clientTime);

    if (timeDiff > 60000) {
      return NextResponse.json({ error: `시간 오차가 너무 큽니다. (PC 시계 동기화 필요)` }, { status: 401 });
    }

    // 2. DB에서 사용자 인증서 확인
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.certificate) {
      return NextResponse.json({ error: 'DB에 등록된 인증서를 찾을 수 없습니다. 인증서 발급을 먼저 진행하세요.' }, { status: 404 });
    }

    // 3. 암호학 검증
    try {
      const pki = forge.pki;
      // PEM 문자열의 혹시 모를 개행 문제를 해결하기 위해 \n 처리
      const certContent = user.certificate.replace(/\\n/g, '\n');
      const cert = pki.certificateFromPem(certContent);
      const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;

      const md = forge.md.sha256.create();
      const messageToVerify = email + time;
      md.update(messageToVerify, 'utf8');

      const signatureBytes = forge.util.hexToBytes(signatureHex);
      const verified = publicKey.verify(md.digest().bytes(), signatureBytes);
      

      if (verified) {
        return NextResponse.json({ message: '신원이 확실하게 증명되었습니다! (서명 일치)' });
      } else {
        // 상세 디버깅을 위한 로그 (콘솔 출력용)
        console.warn(`[Verification Failed] Email: ${email}, Time: ${time}`);
        return NextResponse.json({ error: '전자서명이 유효하지 않습니다. (다른 사람의 키로 서명됨)' }, { status: 401 });
      }
    } catch (cryptoError) {
      console.error("❌ 암호학 연산 에러:", cryptoError);
      return NextResponse.json({ error: '서명 키 또는 인증서 형식이 손상되어 검증할 수 없습니다.' }, { status: 400 });
    }

  } catch (error) {
    console.error('❌ 서버 최상단 에러:', error);
    return NextResponse.json({ error: '서버 내부 로직 에러가 발생했습니다.' }, { status: 500 });
  }
}