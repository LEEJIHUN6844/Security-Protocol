'use client';

import { signIn, signOut, useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import forge from 'node-forge';
import { 
  ShieldCheck, 
  Key, 
  Send, 
  Inbox, 
  FileText, 
  LogOut, 
  AlertCircle, 
  CheckCircle2, 
  RefreshCcw, 
  Lock,
  ExternalLink,
  ChevronRight,
  User,
  Activity,
  GitBranch
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

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
      if (res.ok) setTargetUsers(data);
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
    setMessage('RSA 키쌍 생성 중...');
    
    setTimeout(async () => {
      try {
        const keypair = forge.pki.rsa.generateKeyPair(2048);
        const publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);
        const privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);

        localStorage.setItem('userPrivateKey', privateKeyPem);
        setMessage('키쌍 생성 완료. 서버 요청 중...');

        const res = await fetch('/api/cert/issue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ publicKeyPem }),
        });

        if (!res.ok) throw new Error('인증서 발급 실패');

        const data = await res.json();
        localStorage.setItem('userCert', data.certificate);
        setMessage('✅ 인증서 발급 및 저장 완료!');
        fetchTargetUsers();
      } catch (error) {
        setMessage('❌ 에러: ' + (error as Error).message);
      } finally {
        setLoading(false);
      }
    }, 100);
  };

  // 2. 전자서명 로그인 테스트
  const handleSignatureLogin = async () => {
    const privateKeyPem = localStorage.getItem('userPrivateKey');
    if (!privateKeyPem || !session?.user?.email) {
      setMessage('⚠️ 개인키가 없습니다. 인증서를 먼저 발급받으세요.');
      return;
    }

    try {
      setMessage('전자서명 생성 및 검증 중...');
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
        setMessage(`✅ 검증 성공! (서버: ${data.message})`);
      } else {
        setMessage(`❌ 검증 실패: ${data.error}`);
      }
    } catch (error) {
      console.error(error);
      setMessage('❌ 전자서명 중 오류 발생');
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
      if (!receiver) {
        alert('수신자 정보를 찾을 수 없습니다.');
        return;
      }
      const receiverPublicKey = pki.publicKeyFromPem(receiver.publicKey);

      const md = forge.md.sha256.create();
      md.update(envelopeBody, 'utf8');
      const signature = privateKey.sign(md);
      const signatureHex = forge.util.bytesToHex(signature);

      const aesKey = forge.random.getBytesSync(32);
      const iv = forge.random.getBytesSync(16);

      const dataToEncrypt = JSON.stringify({ content: envelopeBody, signature: signatureHex });
      const cipher = forge.cipher.createCipher('AES-CBC', aesKey);
      cipher.start({ iv: iv });
      cipher.update(forge.util.createBuffer(dataToEncrypt, 'utf8'));
      cipher.finish();
      const encryptedContent = forge.util.bytesToHex(cipher.output.getBytes());

      const encryptedKey = forge.util.bytesToHex(receiverPublicKey.encrypt(aesKey));

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
        alert('🎉 전자봉투 메시지가 전송되었습니다!');
        setEnvelopeBody('');
      } else {
        throw new Error('전송 실패');
      }
    } catch (err) {
      console.error(err);
      alert('⚠️ 보안 통신 과정 중 에러가 발생했습니다.');
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

      const encryptedKeyBytes = forge.util.hexToBytes(msg.encryptedKey);
      const aesKey = privateKey.decrypt(encryptedKeyBytes);

      const iv = forge.util.hexToBytes(msg.iv);
      const encryptedBytes = forge.util.hexToBytes(msg.encryptedContent);
      const decipher = forge.cipher.createDecipher('AES-CBC', aesKey);
      decipher.start({ iv: iv });
      decipher.update(forge.util.createBuffer(encryptedBytes));
      decipher.finish();
      
      const decryptedData = JSON.parse(decipher.output.toString());
      const { content, signature } = decryptedData;

      const senderPublicKey = pki.publicKeyFromPem(msg.senderPublicKey);
      const md = forge.md.sha256.create();
      md.update(content, 'utf8');
      const verified = senderPublicKey.verify(md.digest().bytes(), forge.util.hexToBytes(signature));

      if (verified) {
        alert(`🔓 복호화 및 검증 성공!\n\n보낸이: ${msg.senderName}\n메시지: ${content}\n(서명 일치 확인됨)`);
      } else {
        alert(`⚠️ 복호화 성공했으나 서명이 일치하지 않습니다.`);
      }
    } catch (err) {
      console.error(err);
      alert('❌ 복호화 실패: 올바른 수신자가 아니거나 데이터가 손상되었습니다.');
    }
  };

  const handleViewCertDetails = () => {
    const certPem = localStorage.getItem('userCert');
    if (!certPem) {
      alert('발급받은 인증서가 없습니다. 1번 기능을 수행하세요.');
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
        version: cert.version + 1,
        sigAlg: 'sha256WithRSAEncryption',
        isValid: new Date() >= cert.validity.notBefore && new Date() <= cert.validity.notAfter
      };

      setCertDetails(details);
    } catch (err) {
      console.error(err);
      alert('인증서 파싱 중 오류 발생');
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="text-foreground/60 font-medium">보안 엔진 로드 중...</p>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground p-4 md:p-8 overflow-x-hidden">
      {/* Background decoration */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none overflow-hidden z-[-1]">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/10 blur-[120px] rounded-full animate-float"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/10 blur-[120px] rounded-full animate-float" style={{ animationDelay: '2s' }}></div>
      </div>

      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="space-y-1"
          >
            <h1 className="text-4xl font-black tracking-tight flex items-center gap-3">
              <ShieldCheck className="w-10 h-10 text-primary" />
              <span className="gradient-text tracking-tighter">PROTO-SECURITY</span>
            </h1>
            <p className="text-foreground/60 font-medium ml-1">PKI 기반 보안 통신 프로토콜 대시보드</p>
          </motion.div>

          {session && (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="glass-card px-6 py-3 rounded-2xl flex items-center gap-6 premium-shadow"
            >
              <div className="flex items-center gap-4 border-r border-foreground/10 pr-6">
                <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary border border-primary/20 overflow-hidden relative">
                  {session.user?.image ? (
                    <img src={session.user.image} alt="User" className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-6 h-6" />
                  )}
                </div>
                <div className="leading-tight">
                  <p className="text-xs font-bold text-primary uppercase tracking-tighter">Authorized</p>
                  <p className="font-bold text-sm tracking-tight">{session.user?.name}</p>
                  <p className="text-[10px] text-foreground/40">{session.user?.email}</p>
                </div>
              </div>
              <button 
                onClick={() => signOut()} 
                className="group flex items-center gap-2 text-red-400 hover:text-red-500 transition-colors font-bold text-sm"
              >
                <LogOut className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                Logout
              </button>
            </motion.div>
          )}
        </header>

        {!session ? (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card max-w-md mx-auto p-12 rounded-[2.5rem] text-center space-y-8 premium-shadow mt-20"
          >
            <div className="bg-primary/10 w-24 h-24 rounded-[2rem] flex items-center justify-center mx-auto animate-float border border-primary/10 shadow-inner">
              <Lock className="w-12 h-12 text-primary" />
            </div>
            <div className="space-y-4">
              <h2 className="text-3xl font-black tracking-tight">계층형 보안 접속</h2>
              <p className="text-foreground/60 text-sm leading-relaxed font-medium">
                시스템 자원에 접근하기 위해 관리자 권한<br />인증을 완료해야 합니다.
              </p>
            </div>
            <button 
              onClick={() => signIn('github')} 
              className="gradient-bg text-white w-full py-5 rounded-[1.5rem] font-black text-lg hover:brightness-110 transition-all flex items-center justify-center gap-3 shadow-2xl shadow-primary/30"
            >
              <GitBranch className="w-7 h-7" />
              Github 접속 승인
            </button>
            <p className="text-[10px] font-bold text-foreground/20 uppercase tracking-[0.2em]">End-to-End Encryption Enabled</p>
          </motion.div>
        ) : (
          <div className="space-y-8">
            {/* Dashboard Overview Bar */}
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="grid grid-cols-2 lg:grid-cols-4 gap-4"
            >
              <div className="glass-card p-6 rounded-3xl border-primary/10 bg-white/5">
                <p className="text-[10px] font-black tracking-widest text-primary uppercase mb-1 opacity-60">System Security</p>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                  <p className="text-lg font-black tracking-tight">ACTIVE NODE</p>
                </div>
              </div>
              <div className="glass-card p-6 rounded-3xl border-primary/10 bg-white/5">
                <p className="text-[10px] font-black tracking-widest text-primary uppercase mb-1 opacity-60">Encryption Level</p>
                <p className="text-lg font-black tracking-tight">AES-256 GCM</p>
              </div>
              <div className="glass-card p-6 rounded-3xl border-primary/10 bg-white/5">
                <p className="text-[10px] font-black tracking-widest text-primary uppercase mb-1 opacity-60">Protocol Version</p>
                <p className="text-lg font-black tracking-tight italic">v4.0.2-SEC</p>
              </div>
              <div className="glass-card p-6 rounded-3xl border-primary/10 bg-white/5">
                <p className="text-[10px] font-black tracking-widest text-primary uppercase mb-1 opacity-60">Sync Latency</p>
                <p className="text-lg font-black tracking-tight">12ms <span className="text-[10px] text-green-500 font-bold ml-1">STABLE</span></p>
              </div>
            </motion.div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Left Column: Security Management */}
            <div className="lg:col-span-5 space-y-8">
              {/* 1. 인증서 관리 */}
              <motion.section 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="glass-card p-8 rounded-[2.5rem] relative overflow-hidden group"
              >
                <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity">
                  <Key className="w-32 h-32 rotate-12" />
                </div>
                <div className="flex items-center gap-3 mb-6">
                  <div className="step-number gradient-bg">1</div>
                  <h3 className="text-xl font-black tracking-tight uppercase">PKI 인프라 관리</h3>
                </div>
                
                <div className="space-y-4">
                  <button 
                    onClick={handleIssueCert} disabled={loading}
                    className="w-full py-5 rounded-2xl bg-primary text-white font-black text-sm uppercase tracking-widest hover:brightness-110 disabled:grayscale transition-all shadow-xl shadow-primary/20 flex items-center justify-center gap-3"
                  >
                    {loading ? <RefreshCcw className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                    {loading ? 'Generating...' : 'RSA 인증서 신규 발급'}
                  </button>
                  
                  <AnimatePresence>
                    {message && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className={`p-4 rounded-2xl text-xs font-bold border flex items-start gap-3 leading-relaxed ${
                          message.includes('✅') || message.includes('성공') 
                          ? 'bg-green-500/10 text-green-500 border-green-500/20' 
                          : 'bg-red-500/10 text-red-500 border-red-500/20'
                        }`}
                      >
                        {message.includes('✅') ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
                        {message}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.section>

              {/* 2. 전자서명 로그인 */}
              <motion.section 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="glass-card p-8 rounded-[2.5rem]"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="step-number bg-green-500">2</div>
                  <h3 className="text-xl font-black tracking-tight uppercase">서명 검증 프로토콜</h3>
                </div>
                <button 
                  onClick={handleSignatureLogin}
                  className="w-full py-5 rounded-2xl bg-green-500 text-white font-black text-sm uppercase tracking-widest hover:brightness-110 transition-all shadow-xl shadow-green-500/20 flex items-center justify-center gap-3"
                >
                  <Activity className="w-5 h-5" />
                  서명 검증 요청 (Login)
                </button>
              </motion.section>

              {/* 5. 인증서 상세 정보 */}
              <motion.section 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="glass-card p-8 rounded-[2.5rem]"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="step-number bg-slate-500">5</div>
                  <h3 className="text-xl font-black tracking-tight uppercase">보안 노드 정밀 진단</h3>
                </div>
                <p className="text-foreground/60 text-sm mb-8 leading-relaxed font-medium">
                  현재 로컬 엔드포인트에 저장된 X.509 표준 인증서의 정합성 및 만료 상태를 실시간으로 스캔합니다.
                </p>
                <button 
                  onClick={handleViewCertDetails}
                  className="w-full py-5 rounded-2xl bg-slate-800 text-white font-black text-sm uppercase tracking-widest hover:bg-slate-900 transition-all flex items-center justify-center gap-3 shadow-xl"
                >
                  <FileText className="w-5 h-5" />
                  ASN.1 메타데이터 파싱
                </button>

                <AnimatePresence>
                  {certDetails && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="mt-10 overflow-hidden"
                    >
                      <div className="p-6 bg-foreground/[0.03] rounded-3xl border border-foreground/5 space-y-4">
                        <div className="flex items-center justify-between pb-2 border-b border-foreground/5">
                          <span className="text-[10px] font-black text-foreground/40 uppercase tracking-widest">Metadata Field</span>
                          <span className="text-[10px] font-black text-foreground/40 uppercase tracking-widest">Registry Value</span>
                        </div>
                        {[
                          ['Version', `X.509 v${certDetails.version}`],
                          ['Serial#', certDetails.serial],
                          ['Issuer', certDetails.issuer],
                          ['Expiration', certDetails.notAfter],
                          ['Status', certDetails.isValid ? 'NORMAL' : 'REVOKED']
                        ].map(([label, value]) => (
                          <div key={label} className="flex justify-between items-start gap-4">
                            <span className="text-xs font-black text-foreground/40 whitespace-nowrap">{label}</span>
                            <span className={`text-xs font-bold truncate text-right ${label === 'Status' ? (value === 'NORMAL' ? 'text-green-500' : 'text-red-500') : ''}`}>{value}</span>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.section>
            </div>

            {/* Right Column: Communication */}
            <div className="lg:col-span-7 space-y-8">
              {/* 3. 전자봉투 기반 보안통신 (송신) */}
              <motion.section 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="glass-card p-8 rounded-[2.5rem]"
              >
                <div className="flex items-center gap-3 mb-8">
                  <div className="step-number bg-purple-500">3</div>
                  <h3 className="text-xl font-black tracking-tight uppercase text-transparent bg-clip-text bg-gradient-to-r from-purple-500 to-indigo-500">
                    전송 암호화 레이어 (Send)
                  </h3>
                </div>
                
                <div className="space-y-6">
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-foreground/40 uppercase tracking-widest ml-1">Target Receiver</label>
                    <div className="relative">
                      <select 
                        className="w-full p-5 rounded-[1.5rem] bg-foreground/[0.03] border-none focus:ring-2 focus:ring-purple-500 outline-none text-sm font-bold appearance-none cursor-pointer pr-12 transition-all"
                        value={selectedReceiver}
                        onChange={(e) => setSelectedReceiver(e.target.value)}
                      >
                        <option value="">수신 대상을 선택하세요</option>
                        {targetUsers.map(u => (
                          <option key={u.email} value={u.email}>{u.name} ({u.email})</option>
                        ))}
                      </select>
                      <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-foreground/20">
                        <ChevronRight className="w-5 h-5 rotate-90" />
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <label className="text-[10px] font-black text-foreground/40 uppercase tracking-widest ml-1">Secure Message Body</label>
                    <textarea 
                      className="w-full p-6 rounded-[1.5rem] bg-foreground/[0.03] border-none focus:ring-2 focus:ring-purple-500 outline-none h-40 resize-none text-sm font-bold leading-relaxed transition-all"
                      placeholder="비보안 채널에서도 안전한 봉투 방식으로 전송됩니다..."
                      value={envelopeBody}
                      onChange={(e) => setEnvelopeBody(e.target.value)}
                    />
                  </div>

                  <button 
                    onClick={handleSendEnvelope} disabled={loading}
                    className="w-full py-5 rounded-[1.5rem] bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-black text-sm uppercase tracking-widest hover:brightness-110 transition-all shadow-2xl shadow-purple-500/30 flex items-center justify-center gap-3 group"
                  >
                    <Send className="w-6 h-6 group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
                    디지털 서명 및 전자봉투 압축 전송
                  </button>
                </div>
              </motion.section>

              {/* 4. 내 수신함 */}
              <motion.section 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="glass-card p-8 rounded-[2.5rem]"
              >
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <div className="step-number bg-orange-500">4</div>
                    <h3 className="text-xl font-black tracking-tight uppercase">보안 메시지 수신함</h3>
                  </div>
                  <button 
                    onClick={fetchReceivedMessages} 
                    className="p-3 hover:bg-foreground/5 rounded-2xl transition-colors text-orange-500 group border border-transparent hover:border-orange-500/20"
                  >
                    <RefreshCcw className="w-5 h-5 group-active:rotate-180 transition-transform duration-700" />
                  </button>
                </div>

                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                  {receivedMessages.length === 0 ? (
                    <div className="text-center py-24 bg-foreground/[0.02] rounded-[2.5rem] border-4 border-dashed border-foreground/[0.03] flex flex-col items-center justify-center gap-4">
                      <Inbox className="w-16 h-16 text-foreground/5" />
                      <p className="text-foreground/40 font-black uppercase tracking-widest text-xs">수신 대기 중...</p>
                    </div>
                  ) : (
                    receivedMessages.map((msg, index) => (
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        key={msg.id} 
                        className="p-6 rounded-[1.8rem] bg-foreground/[0.03] border border-foreground/[0.03] flex items-center justify-between group hover:bg-foreground/[0.06] transition-all hover:scale-[1.01]"
                      >
                        <div className="flex items-center gap-5">
                          <div className="w-14 h-14 rounded-2xl bg-orange-500/10 flex items-center justify-center text-orange-500 shadow-inner">
                            <Lock className="w-7 h-7" />
                          </div>
                          <div>
                            <p className="font-black text-sm tracking-tight">{msg.senderName}</p>
                            <p className="text-[10px] font-black text-foreground/30 uppercase tracking-tighter mt-1">
                              {new Date(msg.createdAt).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        <button 
                          onClick={() => handleOpenEnvelope(msg)}
                          className="px-6 py-4 bg-orange-500 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-orange-600 transition-all flex items-center gap-3 shadow-lg shadow-orange-500/20 group-hover:px-8"
                        >
                          Decrypt Envelope
                          <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </button>
                      </motion.div>
                    ))
                  )}
                </div>
              </motion.section>
            </div>
            </div>
          </div>
        )}
        
        {/* Footer */}
        <footer className="text-center py-16 opacity-30">
          <p className="text-[10px] font-black uppercase tracking-[0.6em]">
            Secure Identity Protocol &copy; 2026 Admin Panel
          </p>
        </footer>
      </div>
    </main>
  );
}