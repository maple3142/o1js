import { Field } from './field.js';
import { Gadgets } from './gadgets/gadgets.js';
import { assert } from './errors.js';
import { existsOne, exists } from './gadgets/common.js';
import { TupleN } from './util/types.js';
import { rangeCheck8 } from './gadgets/range-check.js';

export { preNist, nistSha3, ethereum };

// KECCAK CONSTANTS

// Length of the square matrix side of Keccak states
const KECCAK_DIM = 5;

// Value `l` in Keccak, ranges from 0 to 6 and determines the lane width
const KECCAK_ELL = 6;

// Width of a lane of the state, meaning the length of each word in bits (64)
const KECCAK_WORD = 2 ** KECCAK_ELL;

// Number of bytes that fit in a word (8)
const BYTES_PER_WORD = KECCAK_WORD / 8;

// Length of the state in bits, meaning the 5x5 matrix of words in bits (1600)
const KECCAK_STATE_LENGTH = KECCAK_DIM ** 2 * KECCAK_WORD;

// Number of rounds of the Keccak permutation function depending on the value `l` (24)
const KECCAK_ROUNDS = 12 + 2 * KECCAK_ELL;

// Creates the 5x5 table of rotation offset for Keccak modulo 64
//  | x \ y |  0 |  1 |  2 |  3 |  4 |
//  | ----- | -- | -- | -- | -- | -- |
//  | 0     |  0 | 36 |  3 | 41 | 18 |
//  | 1     |  1 | 44 | 10 | 45 |  2 |
//  | 2     | 62 |  6 | 43 | 15 | 61 |
//  | 3     | 28 | 55 | 25 | 21 | 56 |
//  | 4     | 27 | 20 | 39 |  8 | 14 |
const ROT_TABLE = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

// Round constants for Keccak
// From https://keccak.team/files/Keccak-reference-3.0.pdf
const ROUND_CONSTANTS = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
];

function checkBytesToWord(word: Field, wordBytes: Field[]): void {
  let composition = wordBytes.reduce((acc, x, i) => {
    const shift = Field.from(2n ** BigInt(8 * i));
    return acc.add(x.mul(shift));
  }, Field.from(0));

  word.assertEquals(composition);
}

// Return a keccak state where all lanes are equal to 0
const getKeccakStateZeros = (): Field[][] =>
  Array.from(Array(KECCAK_DIM), (_) => Array(KECCAK_DIM).fill(Field.from(0)));

// Converts a list of bytes to a matrix of Field elements
function getKeccakStateOfBytes(bytestring: Field[]): Field[][] {
  assert(bytestring.length === 200, 'improper bytestring length');

  const bytestringArray = Array.from(bytestring);
  const state: Field[][] = getKeccakStateZeros();

  for (let y = 0; y < KECCAK_DIM; y++) {
    for (let x = 0; x < KECCAK_DIM; x++) {
      const idx = BYTES_PER_WORD * (KECCAK_DIM * y + x);
      // Create an array containing the 8 bytes starting on idx that correspond to the word in [x,y]
      const wordBytes = bytestringArray.slice(idx, idx + BYTES_PER_WORD);

      for (let z = 0; z < BYTES_PER_WORD; z++) {
        // Field element containing value 2^(8*z)
        const shift = Field.from(2n ** BigInt(8 * z));
        state[x][y] = state[x][y].add(shift.mul(wordBytes[z]));
      }
    }
  }

  return state;
}

// Converts a state of cvars to a list of bytes as cvars and creates constraints for it
function keccakStateToBytes(state: Field[][]): Field[] {
  const stateLengthInBytes = KECCAK_STATE_LENGTH / 8;
  const bytestring: Field[] = Array.from(
    { length: stateLengthInBytes },
    (_, idx) =>
      existsOne(() => {
        // idx = z + 8 * ((dim * y) + x)
        const z = idx % BYTES_PER_WORD;
        const x = Math.floor(idx / BYTES_PER_WORD) % KECCAK_DIM;
        const y = Math.floor(idx / BYTES_PER_WORD / KECCAK_DIM);
        // [7 6 5 4 3 2 1 0] [x=0,y=1] [x=0,y=2] [x=0,y=3] [x=0,y=4]
        //        [x=1,y=0] [x=1,y=1] [x=1,y=2] [x=1,y=3] [x=1,y=4]
        //        [x=2,y=0] [x=2,y=1] [x=2,y=2] [x=2,y=3] [x=2,y=4]
        //        [x=3,y=0] [x=3,y=1] [x=3,y=2] [x=3,y=3] [x=3,y=4]
        //        [x=4,y=0] [x=4,y=1] [x=4,y=0] [x=4,y=3] [x=4,y=4]
        const word = state[x][y].toBigInt();
        const byte = (word >> BigInt(8 * z)) & BigInt('0xff');
        return byte;
      })
  );

  // Check all words are composed correctly from bytes
  for (let y = 0; y < KECCAK_DIM; y++) {
    for (let x = 0; x < KECCAK_DIM; x++) {
      const idx = BYTES_PER_WORD * (KECCAK_DIM * y + x);
      // Create an array containing the 8 bytes starting on idx that correspond to the word in [x,y]
      const word_bytes = bytestring.slice(idx, idx + BYTES_PER_WORD);
      // Assert correct decomposition of bytes from state
      checkBytesToWord(state[x][y], word_bytes);
    }
  }

  return bytestring;
}

function keccakStateXor(a: Field[][], b: Field[][]): Field[][] {
  assert(
    a.length === KECCAK_DIM && a[0].length === KECCAK_DIM,
    'Invalid input1 dimensions'
  );
  assert(
    b.length === KECCAK_DIM && b[0].length === KECCAK_DIM,
    'Invalid input2 dimensions'
  );

  return a.map((row, rowIndex) =>
    row.map((element, columnIndex) =>
      Gadgets.xor(element, b[rowIndex][columnIndex], 64)
    )
  );
}

// KECCAK HASH FUNCTION

// Computes the number of required extra bytes to pad a message of length bytes
function bytesToPad(rate: number, length: number): number {
  return Math.floor(rate / 8) - (length % Math.floor(rate / 8));
}

// Pads a message M as:
// M || pad[x](|M|)
// Padding rule 0x06 ..0*..1.
// The padded message vector will start with the message vector
// followed by the 0*1 rule to fulfill a length that is a multiple of rate (in bytes)
// (This means a 0110 sequence, followed with as many 0s as needed, and a final 1 bit)
function padNist(message: Field[], rate: number): Field[] {
  // Find out desired length of the padding in bytes
  // If message is already rate bits, need to pad full rate again
  const extraBytes = bytesToPad(rate, message.length);

  // 0x06 0x00 ... 0x00 0x80 or 0x86
  const lastField = BigInt(2) ** BigInt(7);
  const last = Field.from(lastField);

  // Create the padding vector
  const pad = Array(extraBytes).fill(Field.from(0));
  pad[0] = Field.from(6);
  pad[extraBytes - 1] = pad[extraBytes - 1].add(last);

  // Return the padded message
  return [...message, ...pad];
}

// Pads a message M as:
// M || pad[x](|M|)
// Padding rule 10*1.
// The padded message vector will start with the message vector
// followed by the 10*1 rule to fulfill a length that is a multiple of rate (in bytes)
// (This means a 1 bit, followed with as many 0s as needed, and a final 1 bit)
function pad101(message: Field[], rate: number): Field[] {
  // Find out desired length of the padding in bytes
  // If message is already rate bits, need to pad full rate again
  const extraBytes = bytesToPad(rate, message.length);

  // 0x01 0x00 ... 0x00 0x80 or 0x81
  const lastField = BigInt(2) ** BigInt(7);
  const last = Field.from(lastField);

  // Create the padding vector
  const pad = Array(extraBytes).fill(Field.from(0));
  pad[0] = Field.from(1);
  pad[extraBytes - 1] = pad[extraBytes - 1].add(last);

  // Return the padded message
  return [...message, ...pad];
}

// ROUND TRANSFORMATION

// First algorithm in the compression step of Keccak for 64-bit words.
// C[x] = A[x,0] xor A[x,1] xor A[x,2] xor A[x,3] xor A[x,4]
// D[x] = C[x-1] xor ROT(C[x+1], 1)
// E[x,y] = A[x,y] xor D[x]
// In the Keccak reference, it corresponds to the `theta` algorithm.
// We use the first index of the state array as the x coordinate and the second index as the y coordinate.
const theta = (state: Field[][]): Field[][] => {
  const stateA = state;

  // XOR the elements of each row together
  // for all x in {0..4}: C[x] = A[x,0] xor A[x,1] xor A[x,2] xor A[x,3] xor A[x,4]
  const stateC = stateA.map((row) =>
    row.reduce((acc, next) => Gadgets.xor(acc, next, KECCAK_WORD))
  );

  // for all x in {0..4}: D[x] = C[x-1] xor ROT(C[x+1], 1)
  const stateD = Array.from({ length: KECCAK_DIM }, (_, x) =>
    Gadgets.xor(
      stateC[(x + KECCAK_DIM - 1) % KECCAK_DIM],
      Gadgets.rotate(stateC[(x + 1) % KECCAK_DIM], 1, 'left'),
      KECCAK_WORD
    )
  );

  // for all x in {0..4} and y in {0..4}: E[x,y] = A[x,y] xor D[x]
  const stateE = stateA.map((row, index) =>
    row.map((elem) => Gadgets.xor(elem, stateD[index], KECCAK_WORD))
  );

  return stateE;
};

// Second and third steps in the compression step of Keccak for 64-bit words.
// pi: A[x,y] = ROT(E[x,y], r[x,y])
// rho: A[x,y] = A'[y, 2x+3y mod KECCAK_DIM]
// piRho: B[y,2x+3y] = ROT(E[x,y], r[x,y])
// which is equivalent to the `rho` algorithm followed by the `pi` algorithm in the Keccak reference as follows:
// rho:
// A[0,0] = a[0,0]
// | x |  =  | 1 |
// | y |  =  | 0 |
// for t = 0 to 23 do
//   A[x,y] = ROT(a[x,y], (t+1)(t+2)/2 mod 64)))
//   | x |  =  | 0  1 |   | x |
//   |   |  =  |      | * |   |
//   | y |  =  | 2  3 |   | y |
// end for
// pi:
// for x = 0 to 4 do
//   for y = 0 to 4 do
//     | X |  =  | 0  1 |   | x |
//     |   |  =  |      | * |   |
//     | Y |  =  | 2  3 |   | y |
//     A[X,Y] = a[x,y]
//   end for
// end for
// We use the first index of the state array as the x coordinate and the second index as the y coordinate.
function piRho(state: Field[][]): Field[][] {
  const stateE = state;
  const stateB: Field[][] = getKeccakStateZeros();

  // for all x in {0..4} and y in {0..4}: B[y,2x+3y] = ROT(E[x,y], r[x,y])
  for (let x = 0; x < KECCAK_DIM; x++) {
    for (let y = 0; y < KECCAK_DIM; y++) {
      stateB[y][(2 * x + 3 * y) % KECCAK_DIM] = Gadgets.rotate(
        stateE[x][y],
        ROT_TABLE[x][y],
        'left'
      );
    }
  }

  return stateB;
}

// Fourth step of the compression function of Keccak for 64-bit words.
// F[x,y] = B[x,y] xor ((not B[x+1,y]) and B[x+2,y])
// It corresponds to the chi algorithm in the Keccak reference.
// for y = 0 to 4 do
//   for x = 0 to 4 do
//     A[x,y] = a[x,y] xor ((not a[x+1,y]) and a[x+2,y])
//   end for
// end for
function chi(state: Field[][]): Field[][] {
  const stateB = state;
  const stateF = getKeccakStateZeros();

  // for all x in {0..4} and y in {0..4}: F[x,y] = B[x,y] xor ((not B[x+1,y]) and B[x+2,y])
  for (let x = 0; x < KECCAK_DIM; x++) {
    for (let y = 0; y < KECCAK_DIM; y++) {
      stateF[x][y] = Gadgets.xor(
        stateB[x][y],
        Gadgets.and(
          // We can use unchecked NOT because the length of the input is constrained to be 64 bits thanks to the fact that it is the output of a previous Xor64
          Gadgets.not(stateB[(x + 1) % KECCAK_DIM][y], KECCAK_WORD, false),
          stateB[(x + 2) % KECCAK_DIM][y],
          KECCAK_WORD
        ),
        KECCAK_WORD
      );
    }
  }

  return stateF;
}

// Fifth step of the permutation function of Keccak for 64-bit words.
// It takes the word located at the position (0,0) of the state and XORs it with the round constant.
function iota(state: Field[][], rc: Field): Field[][] {
  const stateG = state;

  stateG[0][0] = Gadgets.xor(stateG[0][0], rc, KECCAK_WORD);

  return stateG;
}

// One round of the Keccak permutation function.
// iota o chi o pi o rho o theta
function round(state: Field[][], rc: Field): Field[][] {
  const stateA = state;
  const stateE = theta(stateA);
  const stateB = piRho(stateE);
  const stateF = chi(stateB);
  const stateD = iota(stateF, rc);
  return stateD;
}

// Keccak permutation function with a constant number of rounds
function permutation(state: Field[][], rc: Field[]): Field[][] {
  return rc.reduce(
    (currentState, rcValue) => round(currentState, rcValue),
    state
  );
}

// Absorb padded message into a keccak state with given rate and capacity
function absorb(
  paddedMessage: Field[],
  capacity: number,
  rate: number,
  rc: Field[]
): Field[][] {
  let state = getKeccakStateZeros();

  // split into blocks of rate bits
  // for each block of rate bits in the padded message -> this is rate/8 bytes
  const chunks = [];
  // (capacity / 8) zero bytes
  const zeros = Array(capacity / 8).fill(Field.from(0));

  for (let i = 0; i < paddedMessage.length; i += rate / 8) {
    const block = paddedMessage.slice(i, i + rate / 8);
    // pad the block with 0s to up to 1600 bits
    const paddedBlock = block.concat(zeros);
    // padded with zeros each block until they are 1600 bit long
    assert(
      paddedBlock.length * 8 === KECCAK_STATE_LENGTH,
      'improper Keccak block length'
    );
    const blockState = getKeccakStateOfBytes(paddedBlock);
    // xor the state with the padded block
    const stateXor = keccakStateXor(state, blockState);
    // apply the permutation function to the xored state
    const statePerm = permutation(stateXor, rc);
    state = statePerm;
  }

  return state;
}

// Squeeze state until it has a desired length in bits
function squeeze(
  state: Field[][],
  length: number,
  rate: number,
  rc: Field[]
): Field[] {
  const copy = (
    bytestring: Field[],
    outputArray: Field[],
    start: number,
    length: number
  ) => {
    for (let i = 0; i < length; i++) {
      outputArray[start + i] = bytestring[i];
    }
  };

  let newState = state;

  // bytes per squeeze
  const bytesPerSqueeze = rate / 8;
  // number of squeezes
  const squeezes = Math.floor(length / rate) + 1;
  // multiple of rate that is larger than output_length, in bytes
  const outputLength = squeezes * bytesPerSqueeze;
  // array with sufficient space to store the output
  const outputArray = Array(outputLength).fill(Field.from(0));
  // first state to be squeezed
  const bytestring = keccakStateToBytes(state);
  const outputBytes = bytestring.slice(0, bytesPerSqueeze);
  copy(outputBytes, outputArray, 0, bytesPerSqueeze);
  // for the rest of squeezes
  for (let i = 1; i < squeezes; i++) {
    // apply the permutation function to the state
    newState = permutation(newState, rc);
    // append the output of the permutation function to the output
    const bytestringI = keccakStateToBytes(state);
    const outputBytesI = bytestringI.slice(0, bytesPerSqueeze);
    copy(outputBytesI, outputArray, bytesPerSqueeze * i, bytesPerSqueeze);
  }
  // Obtain the hash selecting the first bitlength/8 bytes of the output array
  const hashed = outputArray.slice(0, length / 8);

  return hashed;
}

// Keccak sponge function for 1600 bits of state width
// Need to split the message into blocks of 1088 bits.
function sponge(
  paddedMessage: Field[],
  length: number,
  capacity: number,
  rate: number
): Field[] {
  // check that the padded message is a multiple of rate
  if ((paddedMessage.length * 8) % rate !== 0) {
    throw new Error('Invalid padded message length');
  }

  // setup cvars for round constants
  let rc = exists(24, () => TupleN.fromArray(24, ROUND_CONSTANTS));

  // absorb
  const state = absorb(paddedMessage, capacity, rate, rc);

  // squeeze
  const hashed = squeeze(state, length, rate, rc);

  return hashed;
}

// TODO(jackryanservia): Use lookup argument once issue is resolved
// Checks in the circuit that a list of cvars are at most 8 bits each
function checkBytes(inputs: Field[]): void {
  inputs.map(rangeCheck8);
}

// Keccak hash function with input message passed as list of Cvar bytes.
// The message will be parsed as follows:
// - the first byte of the message will be the least significant byte of the first word of the state (A[0][0])
// - the 10*1 pad will take place after the message, until reaching the bit length rate.
// - then, {0} pad will take place to finish the 1600 bits of the state.
function hash(
  inpEndian: 'Big' | 'Little' = 'Big',
  outEndian: 'Big' | 'Little' = 'Big',
  byteChecks: boolean = false,
  message: Field[] = [],
  length: number,
  capacity: number,
  nistVersion: boolean
): Field[] {
  assert(capacity > 0, 'capacity must be positive');
  assert(capacity < KECCAK_STATE_LENGTH, 'capacity must be less than 1600');
  assert(length > 0, 'length must be positive');
  assert(length % 8 === 0, 'length must be a multiple of 8');

  // Set input to Big Endian format
  let messageFormatted = inpEndian === 'Big' ? message : message.reverse();

  // Check each cvar input is 8 bits at most if it was not done before at creation time
  if (byteChecks) {
    checkBytes(messageFormatted);
  }

  const rate = KECCAK_STATE_LENGTH - capacity;

  let padded;
  if (nistVersion) {
    padded = padNist(messageFormatted, rate);
  } else {
    padded = pad101(messageFormatted, rate);
  }

  const hash = sponge(padded, length, capacity, rate);

  // Check each cvar output is 8 bits at most. Always because they are created here
  checkBytes(hash);

  // Set input to desired endianness
  const hashFormatted = outEndian === 'Big' ? hash : hash.reverse();

  // Check each cvar output is 8 bits at most
  return hashFormatted;
}

// Gadget for NIST SHA-3 function for output lengths 224/256/384/512.
// Input and output endianness can be specified. Default is big endian.
// Note that when calling with output length 256 this is equivalent to the ethereum function
function nistSha3(
  len: number,
  message: Field[],
  inpEndian: 'Big' | 'Little' = 'Big',
  outEndian: 'Big' | 'Little' = 'Big',
  byteChecks: boolean = false
): Field[] {
  let output: Field[];

  switch (len) {
    case 224:
      output = hash(inpEndian, outEndian, byteChecks, message, 224, 448, true);
      break;
    case 256:
      output = hash(inpEndian, outEndian, byteChecks, message, 256, 512, true);
      break;
    case 384:
      output = hash(inpEndian, outEndian, byteChecks, message, 384, 768, true);
      break;
    case 512:
      output = hash(inpEndian, outEndian, byteChecks, message, 512, 1024, true);
      break;
    default:
      throw new Error('Invalid length');
  }

  return output;
}

// Gadget for Keccak hash function for the parameters used in Ethereum.
// Input and output endianness can be specified. Default is big endian.
function ethereum(
  inpEndian: 'Big' | 'Little' = 'Big',
  outEndian: 'Big' | 'Little' = 'Big',
  byteChecks: boolean = false,
  message: Field[] = []
): Field[] {
  return hash(inpEndian, outEndian, byteChecks, message, 256, 512, false);
}

// Gadget for pre-NIST SHA-3 function for output lengths 224/256/384/512.
// Input and output endianness can be specified. Default is big endian.
// Note that when calling with output length 256 this is equivalent to the ethereum function
function preNist(
  len: number,
  message: Field[],
  inpEndian: 'Big' | 'Little' = 'Big',
  outEndian: 'Big' | 'Little' = 'Big',
  byteChecks: boolean = false
): Field[] {
  switch (len) {
    case 224:
      return hash(inpEndian, outEndian, byteChecks, message, 224, 448, false);
    case 256:
      return ethereum(inpEndian, outEndian, byteChecks, message);
    case 384:
      return hash(inpEndian, outEndian, byteChecks, message, 384, 768, false);
    case 512:
      return hash(inpEndian, outEndian, byteChecks, message, 512, 1024, false);
    default:
      throw new Error('Invalid length');
  }
}
