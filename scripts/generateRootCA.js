const forge = require('node-forge');
const pki = forge.pki;

console.log('Root CA용 2048-bit RSA 키쌍을 생성 중입니다. (시간이 조금 걸릴 수 있습니다...)');
const keys = pki.rsa.generateKeyPair(2048);

const cert = pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01';
cert.validity.notBefore = new Date();
cert.validity.notAfter = new Date();
cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

const attrs = [
  { name: 'commonName', value: 'Joongbu Univ Root CA' },
  { name: 'countryName', value: 'KR' },
  { name: 'organizationName', value: 'Joongbu Univ.' },
  { name: 'organizationalUnitName', value: 'Dept. of Information Security' }
];
cert.setSubject(attrs);
cert.setIssuer(attrs);


cert.setExtensions([
  { name: 'basicConstraints', cA: true },
  { name: 'keyUsage', keyCertSign: true, digitalSignature: true, nonRepudiation: true, keyEncipherment: true, dataEncipherment: true } // 키 용도 설정 [cite: 292, 293, 294, 295, 296, 297]
]);

cert.sign(keys.privateKey, forge.md.sha256.create());


console.log('\n======================================================');
console.log('아래 두 줄을 복사해서 .env 파일에 붙여넣으세요.');
console.log('======================================================\n');
console.log('ROOT_CA_CERT="' + pki.certificateToPem(cert).replace(/\r\n|\n/g, '\\n') + '"');
console.log('ROOT_CA_PRIVATE_KEY="' + pki.privateKeyToPem(keys.privateKey).replace(/\r\n|\n/g, '\\n') + '"');