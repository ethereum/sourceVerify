const dagPB = require('ipld-dag-pb');
const UnixFS = require('ipfs-unixfs');
const multihashes = require('multihashes');
const Web3 = require('web3');
const utils = require('../../services/core/build/utils/utils');

/**
 * Deploys a contract to testrpc
 * @param  {Object} web3
 * @param  {Object} artifact     ex: const Simple = require('./sources/pass/simple.js');
 * @param  {String} contractName ex: "Simple.sol"
 * @param  {String} from         sender address
 * @param  {Array}  args         constructor args
 * @return {Web3Contract}        deployed contract instance
 */
async function deployFromArtifact(web3, artifact, from, args){
  const abi = artifact.compilerOutput.abi;

  args = args || [];

  const options = {
    data: artifact.compilerOutput.evm.bytecode.object,
    gasPrice: '1',
    gas: 4000000,
  };

  // Deploy contract
  const contract = new web3.eth.Contract(abi, options);
  return contract.deploy(...args).send({ from });
}

/**
 * Await `secs` seconds
 * @param  {Number} secs seconds
 * @return {Promise}
 */
async function waitSecs(secs=0){
  return new Promise(resolve => setTimeout(resolve, secs * 1000));
}

/**
 * Derives IPFS hash of string
 * @param  {String} str
 * @return {String}     IPFS hash (ex: "Qm")
 */
async function getIPFSHash(str){
  const file = new UnixFS('file', Buffer.from(str));
  const node = new dagPB.DAGNode(file.marshal());
  const metadataLink = await node.toDAGLink()
  return multihashes.toB58String(metadataLink._cid.multihash);
}

/**
 * Extracts bzzr0 hash from a compiled artifact's deployed bytecode
 * @param  {Object} artifact artifact in ex: test/sources/pass
 * @return {String}          hash
 */
function getBzzr0Hash(artifact){
  const bytes = Web3.utils.hexToBytes(artifact.compilerOutput.evm.deployedBytecode.object);
  const data = utils.cborDecode(bytes);
  const val = Web3.utils.bytesToHex(data.bzzr0).slice(2);

  if (!val.length) throw ('Artifact does not support bzzr0');
  return val;
}

/**
 * Extracts bzzr1 hash from a compiled artifact's deployed bytecode
 * @param  {Object} artifact artifact in ex: test/sources/pass
 * @return {String}          hash
 */
function getBzzr1Hash(artifact){
  const bytes = Web3.utils.hexToBytes(artifact.compilerOutput.evm.deployedBytecode.object);
  const data = utils.cborDecode(bytes);
  const val = Web3.utils.bytesToHex(data.bzzr1).slice(2);

  if (!val.length) throw ('Artifact does not support bzzr1');
  return val;
}

module.exports = {
  deployFromArtifact: deployFromArtifact,
  waitSecs: waitSecs,
  getIPFSHash: getIPFSHash,
  getBzzr0Hash: getBzzr0Hash,
  getBzzr1Hash: getBzzr1Hash
}
