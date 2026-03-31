import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import forge from 'node-forge';
import { verify } from 'crypto';

export async function POST(req: Request) {
  try {
    const { email, time, signatureHex } = await req.json();
    console.log(`[Verify] 요청 데이터 - Email: ${email}, Time: ${time}`);

    if (!email || !time || !signatureHex) {
      return NextResponse.json({ error: '필수 데이터가 누락되었습니다.' }, { status: 400 });
    }

    const clientTime = parseInt(time);
    const serverTime = Date.now();
    const timeDiff = Math.abs(serverTime - clientTime);
    
    if (timeDiff > 30000) {
      return NextResponse.json({ error: '시간 오차가 너무 큽니다. (재전송 공격 의심)' }, { status: 401 });
    }

    
    const user = await prisma.user.findUnique({ where: { email } });
    
    if (!user || !user.certificate) {
      console.log(`[Verify] DB 에러 - 사용자를 찾을 수 없거나 인증서가 없습니다: ${email}`);
      return NextResponse.json({ error: '등록된 인증서를 찾을 수 없습니다.' }, { status: 404 });
    }

    console.log(`[Verify] DB 조회 성공 - 인증서 존재함`);

    
    const pki = forge.pki;
    const cert = pki.certificateFromPem(user.certificate);
    const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;

    
    const md = forge.md.sha256.create();
    const serverMessage = email + time;
    console.log(`[Server Verify] Email: [|${email}|], Time: [|${time}|]`);
    console.log(`[Server Verify] Message to Compare: [|${serverMessage}|]`);
    md.update(serverMessage, 'utf8');

    
    const publicKeyPem = pki.publicKeyToPem(publicKey);
    const signatureBuffer = Buffer.from(signatureHex, 'hex');
    const messageBuffer = Buffer.from(serverMessage, 'utf8');

    const verified = verify(
      'sha256',
      messageBuffer,
      publicKeyPem,
      signatureBuffer
    );
    
    console.log(`[Verify] 결과: ${verified ? '성공' : '실패'}`);

    if (verified) {
      return NextResponse.json({ message: '신원이 확실하게 증명되었습니다! (서명 일치)' });
    } else {
      return NextResponse.json({ error: '전자서명이 유효하지 않습니다. (키가 일치하지 않거나 데이터가 변조됨)' }, { status: 401 });
    }

  } catch (error) {
    console.error('서명 검증 에러:', error);
    return NextResponse.json({ error: '서버 검증 중 에러가 발생했습니다.' }, { status: 500 });
  }
}