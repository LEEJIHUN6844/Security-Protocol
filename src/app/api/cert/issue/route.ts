import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import forge from 'node-forge';

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: '인증되지 않은 사용자입니다.' }, { status: 401 });
    }

    const { publicKeyPem } = await req.json();
    if (!publicKeyPem) {
      return NextResponse.json({ error: '공개키가 필요합니다.' }, { status: 400 });
    }

    const pki = forge.pki;


    const caCert = pki.certificateFromPem(process.env.ROOT_CA_CERT!.replace(/\\n/g, '\n'));
    const caKey = pki.privateKeyFromPem(process.env.ROOT_CA_PRIVATE_KEY!.replace(/\\n/g, '\n'));

    
    const userCert = pki.createCertificate();
    userCert.publicKey = pki.publicKeyFromPem(publicKeyPem); 
    userCert.serialNumber = Date.now().toString(); 
    userCert.validity.notBefore = new Date(); 
    userCert.validity.notAfter = new Date();
    userCert.validity.notAfter.setFullYear(userCert.validity.notBefore.getFullYear() + 1); 

    
    userCert.setSubject([{ name: 'commonName', value: session.user.name || 'Unknown User' }]);
    userCert.setIssuer(caCert.subject.attributes);

   
    userCert.sign(caKey, forge.md.sha256.create());

    const userCertPem = pki.certificateToPem(userCert); 


    await prisma.user.update({
      where: { email: session.user.email },
      data: { 
        certificate: userCertPem, 
        publicKey: publicKeyPem 
      }
    });

    
    return NextResponse.json({ certificate: userCertPem });
  } catch (error) {
    console.error('인증서 발급 에러:', error);
    return NextResponse.json({ error: '인증서 발급 중 서버 에러가 발생했습니다.' }, { status: 500 });
  }
}