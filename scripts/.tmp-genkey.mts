import { writeFileSync } from 'node:fs';
import { generateRequisiteKeyPair } from '@nemo/crypto';
writeFileSync(process.argv[2]!, generateRequisiteKeyPair().publicKey);
