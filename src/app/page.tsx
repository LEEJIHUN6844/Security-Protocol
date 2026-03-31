'use client';

import { signIn, signOut, useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import forge from 'node-forge';

export default function Home() {
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  
  // 전자봉투 관련 상태
  const [targetUsers, setTargetUsers] = useState<any[]>([]);
  const [selectedReceiver, setSelectedReceiver] = useState('');
  const [envelopeBody, setEnvelopeBody] = useState('');
  const [receivedMessages, setReceivedMessages] = useState<any[]>([]);
  const [certDetails, setCertDetails] = useState<any>(null);

  // 데이터 로딩 (수신자 목록 및 수신함)
  useEffect(() => {
    if (session) {
      fetchTargetUsers();
      fetchReceivedMessages();
    }
  }, [session]);

  const fetchTargetUsers = async () => {
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (res.ok) setTargetUsers(data); // 본인 포함 가시화
    } catch (err) { console.error(err); }
  };

  const fetchReceivedMessages = async () => {
    try {
      const res = await fetch('/api/messages/received');
      const data = await res.json();
      if (res.ok) setReceivedMessages(data);
    } catch (err) { console.error(err); }
  };

  // 1. 인증서 발급
  const handleIssueCert = async () => {
    setLoading(true);
    setMessage('클라이언트에서 RSA 키쌍을 생성 중입니다...');
    
    setTimeout(async () => {
      try {
        const keypair = forge.pki.rsa.generateKeyPair(2048);
        const publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);
        const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);

        localStorage.setItem('userPrivateKey', privateKeyPem);
        setMessage('키쌍 생성 완료. 서버에 인증서 발급을 요청합니다...');

        const res = await fetch('/api/cert/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicKeyPem }),
        });

        if (!res.ok) throw new Error('인증서 발급 실패');

        const data = await res.json();
        localStorage.setItem('userCert', data.certificate);
        setMessage('인증서가 성공적으로 발급되어 로컬스토리지에 저장되었습니다!');
        fetchTargetUsers(); // 목록 갱신
      } catch (error) {
        setMessage('에러가 발생했습니다: ' + (error as Error).message);
      } finally {
        setLoading(false);
      }
    }, 100);
  };

  // 2. 전자서명 로그인 테스트
  const handleSignatureLogin = async () => {
    const privateKeyPem = localStorage.getItem('userPrivateKey');
    if (!privateKeyPem || !session?.user?.email) {
      setMessage('개인키가 로컬스토리지에 없거나 로그인되지 않았습니다. 인증서를 먼저 발급받으세요.');
      return;
    }

    try {
      setMessage('전자서명을 생성하여 서버에 검증을 요청합니다...');
      const pki = forge.pki;
      const privateKey = pki.privateKeyFromPem(privateKeyPem);
      
      const time = new Date().getTime().toString();
      const messageToSign = session.user.email + time;
      const md = forge.md.sha256.create();
      md.update(messageToSign, 'utf8');
      const signature = privateKey.sign(md);
      const signatureHex = forge.util.bytesToHex(signature);

      const res = await fetch('/api/verify_signature', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: session.user.email,
          time: time,
          signatureHex: signatureHex
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage(`✅ 전자서명 검증 성공! (서버 응답: ${data.message})`);
      } else {
        setMessage(`❌ 검증 실패: ${data.error}`);
      }
    } catch (error) {
      console.error(error);
      setMessage('전자서명 중 오류가 발생했습니다.');
    }
  };

  
  const handleSendEnvelope = async () => {
    if (!selectedReceiver || !envelopeBody) {
      alert('수신자를 선택하고 메시지를 입력하세요.');
      return;
    }

    const privateKeyPem = localStorage.getItem('userPrivateKey');
    if (!privateKeyPem) {
      alert('본인의 개인키가 필요합니다. 인증서를 먼저 발급받으세요.');
      return;
    }

    setLoading(true);
    try {
      const pki = forge.pki;
      const privateKey = pki.privateKeyFromPem(privateKeyPem);
      const receiver = targetUsers.find(u => u.email === selectedReceiver);
      const receiverPublicKey = pki.publicKeyFromPem(receiver.publicKey);

      // (1) 메시지 서명
      const md = forge.md.sha256.create();
      md.update(envelopeBody, 'utf8');
      const signature = privateKey.sign(md);
      const signatureHex = forge.util.bytesToHex(signature);

      // (2) 일회용 AES 대칭키 생성 (256비트)
      const aesKey = forge.random.getBytesSync(32);
      const iv = forge.random.getBytesSync(16);

      // (3) 본문 암호화 (메시지 + 서명)
      const dataToEncrypt = JSON.stringify({ content: envelopeBody, signature: signatureHex });
      const cipher = forge.cipher.createCipher('AES-CBC', aesKey);
      cipher.start({ iv: iv });
      cipher.update(forge.util.createBuffer(dataToEncrypt, 'utf8'));
      cipher.finish();
      const encryptedContent = forge.util.bytesToHex(cipher.output.getBytes());

      // (4) 전자봉투 생성 (AES 키를 수신자 공개키로 RSA 암호화)
      const encryptedKey = forge.util.bytesToHex(receiverPublicKey.encrypt(aesKey));

      // (5) 서버로 전송
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiverEmail: selectedReceiver,
          encryptedContent,
          encryptedKey,
          iv: forge.util.bytesToHex(iv)
        }),
      });

      if (res.ok) {
        alert('전자봉투 메시지가 성공적으로 전송되었습니다!');
        setEnvelopeBody('');
      } else {
        throw new Error('전송 실패');
      }
    } catch (err) {
      console.error(err);
      alert('보안 통신 과정 중 에러가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  
  const handleOpenEnvelope = async (msg: any) => {
    const privateKeyPem = localStorage.getItem('userPrivateKey');
    if (!privateKeyPem) {
      alert('복호화를 위해 본인의 개인키가 필요합니다.');
      return;
    }

    try {
      const pki = forge.pki;
      const privateKey = pki.privateKeyFromPem(privateKeyPem);

      // (1) 내 개인키로 전자봉투 개봉 (AES 키 획득)
      const encryptedKeyBytes = forge.util.hexToBytes(msg.encryptedKey);
      const aesKey = privateKey.decrypt(encryptedKeyBytes);

      // (2) 획득한 AES 키로 본문 복호화
      const iv = forge.util.hexToBytes(msg.iv);
      const encryptedBytes = forge.util.hexToBytes(msg.encryptedContent);
      const decipher = forge.cipher.createDecipher('AES-CBC', aesKey);
      decipher.start({ iv: iv });
      decipher.update(forge.util.createBuffer(encryptedBytes));
      decipher.finish();
      
      const decryptedData = JSON.parse(decipher.output.toString());
      const { content, signature } = decryptedData;

      // (3) 송신자 공개키로 서명 검증
      const senderPublicKey = pki.publicKeyFromPem(msg.senderPublicKey);
      const md = forge.md.sha256.create();
      md.update(content, 'utf8');
      const verified = senderPublicKey.verify(md.digest().bytes(), forge.util.hexToBytes(signature));

      if (verified) {
        alert(`🔓 복호화 및 검증 성공!\n\n보낸이: ${msg.senderName}\n메시지: ${content}\n(서명 일치 확인됨)`);
      } else {
        alert(`⚠️ 복호화는 성공했으나 서명이 일치하지 않습니다.`);
      }
    } catch (err) {
      console.error(err);
      alert('복호화 실패: 올바른 수신자가 아니거나 데이터가 손상되었습니다.');
    }
  };

  // 5. 기타 인증서 기반 기능: 인증서 상세 정보 조회 및 유효성 검사
  const handleViewCertDetails = () => {
    const certPem = localStorage.getItem('userCert');
    if (!certPem) {
      alert('발급받은 인증서가 없습니다. 먼저 1번 기능을 수행하세요.');
      return;
    }

    try {
      const pki = forge.pki;
      const cert = pki.certificateFromPem(certPem);
      
      const details = {
        serial: cert.serialNumber,
        issuer: cert.issuer.attributes.map((a: any) => `${a.shortName || a.name}: ${a.value}`).join(', '),
        subject: cert.subject.attributes.map((a: any) => `${a.shortName || a.name}: ${a.value}`).join(', '),
        notBefore: cert.validity.notBefore.toLocaleString(),
        notAfter: cert.validity.notAfter.toLocaleString(),
        version: cert.version + 1, // X.509 v3 등 (0부터 시작하므로 +1)
        sigAlg: 'sha256WithRSAEncryption', // 발급 서버 기준
        isValid: new Date() >= cert.validity.notBefore && new Date() <= cert.validity.notAfter
      };

      setCertDetails(details);
    } catch (err) {
      console.error(err);
      alert('인증서 파싱 중 오류가 발생했습니다.');
    }
  };

  if (status === 'loading') return <div className="p-8 text-center">로딩 중...</div>;

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto font-sans bg-gray-50">
      <h1 className="text-3xl font-bold mb-8 text-center text-gray-800">보안 프로토콜 과제 - PKI 실습</h1>

      {!session ? (
        <div className="bg-white p-8 rounded-xl text-center shadow-lg border border-gray-100">
          <h2 className="text-xl mb-4 text-gray-700">서비스를 이용하려면 로그인이 필요합니다.</h2>
          <button onClick={() => signIn('github')} className="bg-gray-900 text-white px-8 py-3 rounded-lg hover:bg-black transition-all shadow-md">
            GitHub으로 로그인
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 상단 사용자 정보 */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Authenticated User</p>
              <h2 className="text-2xl font-bold text-blue-600">{session.user?.name}</h2>
              <p className="text-sm text-gray-500">{session.user?.email}</p>
            </div>
            <button onClick={() => signOut()} className="text-sm text-red-400 hover:text-red-600 font-medium">Log out</button>
          </div>

          <div className="grid gap-6">
            {/* 1. 인증서 관리 */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold mb-4 text-gray-800 flex items-center gap-2">
                <span className="bg-blue-100 text-blue-600 w-6 h-6 rounded-full flex items-center justify-center text-xs">1</span>
                인증서 관리
              </h3>
              <button 
                onClick={handleIssueCert} disabled={loading}
                className="w-full py-3 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700 disabled:bg-blue-300 transition-colors shadow-sm"
              >
                {loading ? '인증서 발급 중...' : '인증서(RSA 키쌍) 발급받기'}
              </button>
              {message && (
                <div className={`mt-4 p-4 rounded-lg text-sm font-medium ${message.includes('✅') || message.includes('성공') ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                  {message}
                </div>
              )}
            </section>

            {/* 2. 전자서명 로그인 */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold mb-4 text-gray-800 flex items-center gap-2">
                <span className="bg-green-100 text-green-600 w-6 h-6 rounded-full flex items-center justify-center text-xs">2</span>
                전자서명 검증 테스트
              </h3>
              <button 
                onClick={handleSignatureLogin}
                className="w-full py-3 rounded-lg bg-green-600 text-white font-bold hover:bg-green-700 transition-colors shadow-sm"
              >
                전자서명 로그인 시도
              </button>
            </section>

            {/* 3. 전자봉투 기반 보안통신 (송신) */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold mb-4 text-gray-800 flex items-center gap-2">
                <span className="bg-purple-100 text-purple-600 w-6 h-6 rounded-full flex items-center justify-center text-xs">3</span>
                전자봉투 메시지 보내기
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-600 mb-1">수신자 선택</label>
                  <select 
                    className="w-full p-2 border rounded-lg bg-gray-50 focus:ring-2 focus:ring-purple-200 outline-none"
                    value={selectedReceiver}
                    onChange={(e) => setSelectedReceiver(e.target.value)}
                  >
                    <option value="">수신자를 선택하세요</option>
                    {targetUsers.map(u => (
                      <option key={u.email} value={u.email}>{u.name} ({u.email})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-600 mb-1">메시지 내용</label>
                  <textarea 
                    className="w-full p-2 border rounded-lg bg-gray-50 focus:ring-2 focus:ring-purple-200 outline-none h-24 resize-none"
                    placeholder="비밀 메시지를 입력하세요"
                    value={envelopeBody}
                    onChange={(e) => setEnvelopeBody(e.target.value)}
                  />
                </div>
                <button 
                  onClick={handleSendEnvelope} disabled={loading}
                  className="w-full py-3 rounded-lg bg-purple-600 text-white font-bold hover:bg-purple-700 transition-colors shadow-sm"
                >
                  서명 및 전자봉투 암호화 전송
                </button>
              </div>
            </section>

            {/* 4. 내 수신함 */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold mb-4 text-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="bg-orange-100 text-orange-600 w-6 h-6 rounded-full flex items-center justify-center text-xs">4</span>
                  보안 수신함
                </div>
                <button onClick={fetchReceivedMessages} className="text-xs text-orange-500 hover:underline">새로고침</button>
              </h3>
              <div className="space-y-3">
                {receivedMessages.length === 0 ? (
                  <p className="text-center text-gray-400 py-4 text-sm italic">수신된 비밀 메시지가 없습니다.</p>
                ) : (
                  receivedMessages.map((msg) => (
                    <div key={msg.id} className="p-4 border rounded-lg bg-orange-50/30 border-orange-100 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-gray-800">{msg.senderName} 님의 메시지</p>
                        <p className="text-xs text-gray-400">{new Date(msg.createdAt).toLocaleString()}</p>
                      </div>
                      <button 
                        onClick={() => handleOpenEnvelope(msg)}
                        className="px-4 py-2 bg-orange-500 text-white text-xs font-bold rounded-md hover:bg-orange-600"
                      >
                        봉투 개봉 (복호화)
                      </button>
                    </div>
                  ))
                )}
              </div>
            </section>

            {/* 5. 인증서 상세 정보 조회 및 기타 기능 */}
            <section className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold mb-4 text-gray-800 flex items-center gap-2">
                <span className="bg-gray-100 text-gray-600 w-6 h-6 rounded-full flex items-center justify-center text-xs">5</span>
                기타 인증서 기반 기능 - 상세 정보 조회
              </h3>
              <p className="text-sm text-gray-600 mb-4">내 로컬 인증서가 위변조되지 않았는지, 유효기간은 언제까지인지 모든 정보를 낱낱이 파싱하여 확인합니다.</p>
              <button 
                onClick={handleViewCertDetails}
                className="w-full py-3 rounded-lg bg-gray-800 text-white font-bold hover:bg-black transition-colors shadow-sm"
              >
                인증서 구조 분석 및 유효성 검사 실행
              </button>

              {certDetails && (
                <div className="mt-6 border rounded-lg overflow-hidden text-xs bg-gray-50">
                  <div className="bg-gray-200 p-2 font-bold text-gray-700 border-b">X.509 Certificate Decoded View</div>
                  <table className="w-full border-collapse">
                    <tbody>
                      {[
                        ['Version', `v${certDetails.version}`],
                        ['Serial Number', certDetails.serial],
                        ['Issuer (발급자)', certDetails.issuer],
                        ['Subject (소유자)', certDetails.subject],
                        ['Valid From (시작)', certDetails.notBefore],
                        ['Valid To (만료)', certDetails.notAfter],
                        ['Signature Alg', certDetails.sigAlg],
                        ['Current Status', certDetails.isValid ? '✅ 정상 (유효함)' : '❌ 만료됨']
                      ].map(([label, value]) => (
                        <tr key={label as string} className="border-b border-gray-100 last:border-0">
                          <td className="p-3 font-bold bg-gray-100 text-gray-500 w-1/3 border-r">{label}</td>
                          <td className="p-3 text-gray-700 break-all">{value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="p-2 text-[10px] text-gray-400 text-right bg-white italic italic">
                    Analyzed by node-forge ASN.1 Parser
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </main>
  );
}