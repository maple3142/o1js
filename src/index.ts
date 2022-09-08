export {
  Group,
  Scalar,
  AsFieldElements,
  Ledger,
  isReady,
  shutdown,
} from './snarky.js';
export { Field, Bool } from './lib/core.js';
export type { VerificationKey, Keypair } from './snarky.js';
export * from './snarky/addons.js';
export { Poseidon } from './lib/hash.js';
export * from './lib/signature.js';
export {
  Circuit,
  CircuitValue,
  prop,
  arrayProp,
  matrixProp,
  public_,
  circuitMain,
  circuitValue,
} from './lib/circuit_value.js';
export { UInt32, UInt64, Int64, Sign } from './lib/int.js';
export { Types } from './snarky/types.js';

export * as Mina from './lib/mina.js';
export {
  SmartContract,
  method,
  deploy,
  DeployArgs,
  signFeePayer,
  declareMethods,
} from './lib/zkapp.js';
export { state, State, declareState } from './lib/state.js';
export { Proof, SelfProof, ZkProgram, verify } from './lib/proof_system.js';

export {
  Token,
  AccountUpdate,
  Permissions,
  ZkappPublicInput,
  zkappCommandToJson,
} from './lib/account_update.js';
export {
  fetchAccount,
  fetchLastBlock,
  addCachedAccount,
  setGraphqlEndpoint,
  sendZkapp,
} from './lib/fetch.js';
export * as Encryption from './lib/encryption.js';
export * as Encoding from './lib/encoding.js';
export { Character, CircuitString } from './lib/string.js';

// experimental APIs
import { Reducer, Callback, accountUpdateFromCallback } from './lib/zkapp.js';
import { createChildAccountUpdate } from './lib/account_update.js';
import {
  memoizeWitness,
  AsFieldsAndAux as AsFieldsAndAux_,
} from './lib/circuit_value.js';
import { MerkleTree, MerkleWitness } from './lib/merkle_tree.js';
export { Experimental };

const Experimental_ = {
  Reducer,
  Callback,
  accountUpdateFromCallback,
  createChildAccountUpdate,
  memoizeWitness,
  MerkleTree,
  MerkleWitness,
};

type Callback_ = Callback;

/**
 * This module exposes APIs that are unstable, in the sense that the API surface is expected to change.
 * (Not unstable in the sense that they are less functional or tested than other parts.)
 */
namespace Experimental {
  export let Reducer = Experimental_.Reducer;
  export let createChildAccountUpdate = Experimental_.createChildAccountUpdate;
  export let memoizeWitness = Experimental_.memoizeWitness;
  export let MerkleTree = Experimental_.MerkleTree;
  export let MerkleWitness = Experimental_.MerkleWitness;
  export let accountUpdateFromCallback = Experimental_.accountUpdateFromCallback;
  export type AsFieldsAndAux<T, TJson> = AsFieldsAndAux_<T, TJson>;
  export let Callback = Experimental_.Callback;
  export type Callback = Callback_;
}
