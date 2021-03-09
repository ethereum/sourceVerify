process.env.TESTING = true;
process.env.LOCALCHAIN_URL = "http://localhost:8545";
process.env.MOCK_REPOSITORY = './dist/data/mock-repository';
process.env.MOCK_DATABASE = './dist/data/mock-database';
process.env.SOLC_REPO = './dist/data/solc-repo';
process.env.SOLJSON_REPO = '/dist/data/soljson-repo';

const chai = require("chai");
const chaiHttp = require("chai-http");
const Server = require("../dist/server/server").Server;
const util = require("util");
const fs = require("fs");
const rimraf = require("rimraf");
const path = require("path");
const MAX_INPUT_SIZE = require("../dist/server/controllers/VerificationController").default.MAX_INPUT_SIZE;
const StatusCodes = require('http-status-codes').StatusCodes;
chai.use(chaiHttp);

const EXTENDED_TIME = 15000; // 15 seconds

describe("Server", function() {
    const server = new Server();

    before(async () => {
        const promisified = util.promisify(server.app.listen);
        await promisified(server.port);
        console.log(`Injector listening on port ${server.port}!`);
    });

    beforeEach(() => {
        rimraf.sync(server.repository);
    });

    after(() => {
        rimraf.sync(server.repository);
    });

    const sourcePath = path.join("test", "testcontracts", "1_Storage", "1_Storage.sol");
    const sourceBuffer = fs.readFileSync(sourcePath);

    const metadataPath = path.join("test", "testcontracts", "1_Storage", "metadata.json");
    const metadataBuffer = fs.readFileSync(metadataPath);
    const metadata = JSON.parse(metadataBuffer.toString());
    const ipfsAddress = metadata.sources["browser/1_Storage.sol"].urls[1];

    // change the last char in ipfs hash of the source file
    const lastChar = ipfsAddress.charAt(ipfsAddress.length-1);
    const modifiedLastChar = lastChar === "a" ? "b" : "a";
    const modifiedIpfsAddress = ipfsAddress.slice(0, ipfsAddress.length-1) + modifiedLastChar;
    metadata.sources["browser/1_Storage.sol"].urls[1] = modifiedIpfsAddress;
    const modifiedMetadataBuffer = Buffer.from(JSON.stringify(metadata));

    const contractChain = "5"; // goerli
    const contractAddress = "0x000000bCB92160f8B7E094998Af6BCaD7fa537fe";
    const fakeAddress = "0x000000bCB92160f8B7E094998Af6BCaD7fa537ff"

    const assertError = (err, res, field) => {
        chai.expect(err).to.be.null;
        chai.expect(res.status).to.equal(StatusCodes.BAD_REQUEST);
        chai.expect(res.body.message.startsWith("Validation Error")).to.be.true;
        chai.expect(res.body.errors).to.be.an("array");
        chai.expect(res.body.errors).to.have.a.lengthOf(1);
        chai.expect(res.body.errors[0].field).to.equal(field);
    }

    describe("/check-by-addresses", function() {
        this.timeout(EXTENDED_TIME);

        it("should fail for missing chainIds", (done) => {
            chai.request(server.app)
                .get("/check-by-addresses")
                .query({ addresses: contractAddress })
                .end((err, res) => {
                    assertError(err, res, "chainIds");
                    done();
                });
        });

        it("should fail for missing addresses", (done) => {
            chai.request(server.app)
                .get("/check-by-addresses")
                .query({ chainIds: 1 })
                .end((err, res) => {
                    assertError(err, res, "addresses");
                    done();
                });
        });

        const assertStatus = (err, res, expectedStatus, expectedChainIds, done) => {
            chai.expect(err).to.be.null;
            chai.expect(res.status).to.equal(StatusCodes.OK);
            const resultArray = res.body;
            chai.expect(resultArray).to.have.a.lengthOf(1);
            const result = resultArray[0];
            chai.expect(result.address).to.equal(contractAddress);
            chai.expect(result.status).to.equal(expectedStatus);
            chai.expect(result.chainIds).to.deep.equal(expectedChainIds)
            if (done) done();
        }

        it("should return false for previously unverified contract", (done) => {
            chai.request(server.app)
                .get("/check-by-addresses")
                .query({ chainIds: contractChain, addresses: contractAddress })
                .end((err, res) => assertStatus(err, res, "false", undefined, done));
        });

        it("should fail for invalid address", (done) => {
            chai.request(server.app)
                .get("/check-by-addresses")
                .query({ chainIds: contractChain, addresses: fakeAddress })
                .end((err, res) => {
                    assertError(err, res, "addresses");
                    done();
                });
        });

        it("should return true for previously verified contract", (done) => {
            chai.request(server.app)
                .get("/check-by-addresses")
                .query({ chainIds: contractChain, addresses: contractAddress })
                .end((err, res) => {
                    assertStatus(err, res, "false", undefined);
                    chai.request(server.app).post("/")
                        .field("address", contractAddress)
                        .field("chain", contractChain)
                        .attach("files", metadataBuffer, "metadata.json")
                        .attach("files", sourceBuffer)
                        .end((err, res) => {
                            chai.expect(err).to.be.null;
                            chai.expect(res.status).to.equal(StatusCodes.OK);

                            chai.request(server.app)
                                .get("/check-by-addresses")
                                .query({ chainIds: contractChain, addresses: contractAddress })
                                .end((err, res) => assertStatus(err, res, "perfect", [contractChain], done));
                        });     
                });
        });
    });

    const checkNonVerified = (path, done) => {
        chai.request(server.app)
                .post(path)
                .field("chain", contractChain)
                .field("address", contractAddress)
                .end((err, res) => {
                    chai.expect(err).to.be.null;
                    chai.expect(res.body).to.haveOwnProperty("error");
                    chai.expect(res.status).to.equal(StatusCodes.NOT_FOUND);
                    done();
                });
    }

    describe("/", function() {
        this.timeout(EXTENDED_TIME);

        it("should correctly inform for an address check of a non verified contract (at /)", (done) => {
            checkNonVerified("/", done);
        });

        it("should correctly inform for an address check of a non verified contract (at /verify)", (done) => {
            checkNonVerified("/verify", done);
        });

        const assertions = (err, res, done) => {
            chai.expect(err).to.be.null;
            chai.expect(res.status).to.equal(StatusCodes.OK);
            chai.expect(res.body).to.haveOwnProperty("result");
            const resultArr = res.body.result;
            chai.expect(resultArr).to.have.a.lengthOf(1);
            const result = resultArr[0];
            chai.expect(result.address).to.equal(contractAddress);
            chai.expect(result.status).to.equal("perfect");
            done();
        }

        it("should verify multipart upload", (done) => {
            chai.request(server.app)
                .post("/")
                .field("address", contractAddress)
                .field("chain", contractChain)
                .attach("files", metadataBuffer, "metadata.json")
                .attach("files", sourceBuffer, "1_Storage.sol")
                .end((err, res) => assertions(err, res, done));
        });

        it("should verify json upload with string properties", (done) => {
            chai.request(server.app)
                .post("/")
                .send({
                    address: contractAddress,
                    chain: contractChain,
                    files: {
                        "metadata.json": metadataBuffer.toString(),
                        "1_Storage.sol": sourceBuffer.toString()
                    }
                })
                .end((err, res) => assertions(err, res, done));
        });

        it("should verify json upload with Buffer properties", (done) => {
            chai.request(server.app)
                .post("/")
                .send({
                    address: contractAddress,
                    chain: contractChain,
                    files: {
                        "metadata.json": metadataBuffer,
                        "1_Storage.sol": sourceBuffer
                    }
                })
                .end((err, res) => assertions(err, res, done));
        });

        const assertMissingFile = (err, res) => {
            chai.expect(err).to.be.null;
            chai.expect(res.body).to.haveOwnProperty("error");
            const errorMessage = res.body.error.toLowerCase();
            chai.expect(res.status).to.equal(StatusCodes.INTERNAL_SERVER_ERROR);
            chai.expect(errorMessage).to.include("missing");
            chai.expect(errorMessage).to.include("Storage".toLowerCase());
        }

        it("should return Bad Request Error for a source that is missing and unfetchable", (done) => {
            chai.request(server.app)
                .post("/")
                .field("address", contractAddress)
                .field("chain", contractChain)
                .attach("files", modifiedMetadataBuffer, "metadata.json")
                .end((err, res) => {
                    assertMissingFile(err, res);
                    done();
                });
        });

        it("should fetch a missing file that is accessible via ipfs", (done) => {
            chai.request(server.app)
                .post("/")
                .field("address", contractAddress)
                .field("chain", contractChain)
                .attach("files", metadataBuffer, "metadata.json")
                .end((err, res) => assertions(err, res, done));
        });
    });

    describe("verification v2", function() {
        this.timeout(EXTENDED_TIME);

        it("should inform when no pending contracts", (done) => {
            chai.request(server.app)
                .post("/verify-validated")
                .end((err, res) => {
                    chai.expect(err).to.be.null;
                    chai.expect(res.body).to.haveOwnProperty("error");
                    chai.expect(res.status).to.equal(StatusCodes.BAD_REQUEST);
                    chai.expect(res.body.error).to.equal("There are currently no pending contracts.")
                    done();
                });
        });

        const assertAddressAndChainMissing = (res, expectedFound, expectedMissing) => {
            chai.expect(res.status).to.equal(StatusCodes.OK);
            const contracts = res.body.contracts;
            chai.expect(contracts).to.have.a.lengthOf(1);

            const contract = contracts[0];
            chai.expect(contract.status).to.equal("error");
            chai.expect(contract.files.missing).to.deep.equal(expectedMissing);
            chai.expect(contract.files.found).to.deep.equal(expectedFound);
            chai.expect(res.body.unused).to.be.empty;
            chai.expect(contract.storageTimestamp).to.equal(undefined);
            return contracts;
        };

        it("should accept file upload in JSON format", (done) => {
            chai.request(server.app)
                .post("/input-files")
                .send({
                    files: {
                        "metadata.json": metadataBuffer.toString(),
                        "1_Storage.sol": sourceBuffer.toString()
                    }
                }).then(res => {
                    assertAddressAndChainMissing(res, ["browser/1_Storage.sol"], []);
                    done();
                });
        });

        it("should not verify after addition of metadata+source, but should after providing address+chainId", (done) => {
            const agent = chai.request.agent(server.app);
            agent.post("/input-files")
                .attach("files", sourceBuffer, "1_Storage.sol")
                .attach("files", metadataBuffer, "metadata.json")
                .then(res => {
                    const contracts = assertAddressAndChainMissing(res, ["browser/1_Storage.sol"], []);
                    contracts[0].address = contractAddress;
                    contracts[0].chainId = contractChain;

                    agent.post("/verify-validated")
                        .send({ contracts })
                        .end((err, res) => {
                            chai.expect(err).to.be.null;
                            chai.expect(res.status).to.equal(StatusCodes.OK);
                            const contracts = res.body.contracts;
                            chai.expect(contracts).to.have.a.lengthOf(1);
                            const contract = contracts[0];
                            chai.expect(contract.status).to.equal("perfect");
                            chai.expect(contract.storageTimestamp).to.not.exist;
                            chai.expect(res.body.unused).to.be.empty;
                            done();
                        });
            });
        });

        const assertAfterMetadataUpload = (err, res) => {
            chai.expect(err).to.be.null;
            chai.expect(res.status).to.equal(StatusCodes.OK);
            chai.expect(res.body.unused).to.be.empty;

            const contracts = res.body.contracts;
            chai.expect(contracts).to.have.a.lengthOf(1);
            const contract = contracts[0];

            chai.expect(contract.name).to.equal("Storage");
            chai.expect(contract.status).to.equal("error");
        }

        it("should not verify when session cookie not stored clientside", (done) => {
            chai.request(server.app)
                .post("/input-files")
                .attach("files", metadataBuffer, "metadata.json")
                .end((err, res) => {
                    assertAfterMetadataUpload(err, res);

                    chai.request(server.app)
                        .post("/input-files")
                        .attach("files", sourceBuffer, "1_Storage.sol")
                        .end((err, res) => {
                            chai.expect(err).to.be.null;
                            chai.expect(res.status).to.equal(StatusCodes.OK);

                            chai.expect(res.body.unused).to.deep.equal(["1_Storage.sol"]);
                            chai.expect(res.body.contracts).to.be.empty;
                            done();
                        });
                });
        });

        const assertAllFound = (err, res, finalStatus) => {
            chai.expect(err).to.be.null;
            chai.expect(res.status).to.equal(StatusCodes.OK);
            chai.expect(res.body.unused).to.be.empty;

            const contracts = res.body.contracts;
            chai.expect(contracts).to.have.a.lengthOf(1);
            const contract = contracts[0];

            chai.expect(contract.name).to.equal("Storage");
            chai.expect(contract.status).to.equal(finalStatus);
            chai.expect(contract.storageTimestamp).to.not.exist;
        }

        it("should verify when session cookie stored clientside", (done) => {
            const agent = chai.request.agent(server.app);
            agent.post("/input-files")
                .attach("files", metadataBuffer, "metadata.json")
                .end((err, res) => {
                    assertAfterMetadataUpload(err, res);
                    const contracts = res.body.contracts;

                    agent.post("/input-files")
                        .attach("files", sourceBuffer, "1_Storage.sol")
                        .end((err, res) => {
                            contracts[0].chainId = contractChain;
                            contracts[0].address = contractAddress;
                            assertAllFound(err, res, "error");

                            agent.post("/verify-validated")
                                .send({ contracts })
                                .end((err, res) => {
                                    assertAllFound(err, res, "perfect");
                                    done();
                                });
                        });
                });
        });

        it("should fail if too many files uploaded, but should succeed after deletion", (done) => {
            const agent = chai.request.agent(server.app);

            const file = "a".repeat(MAX_INPUT_SIZE);
            agent.post("/input-files")
                .attach("files", Buffer.from(file))
                .then(res => {
                    chai.expect(res.status).to.equal(StatusCodes.OK);

                    agent.post("/input-files")
                        .attach("files", Buffer.from("a"))
                        .then(res => {
                            chai.expect(res.status).to.equal(StatusCodes.REQUEST_TOO_LONG);
                            chai.expect(res.body.error).to.exist;

                            agent.post("/restart-session")
                                .then(res => {
                                    chai.expect(res.status).to.equal(StatusCodes.OK);

                                    agent.post("/input-files")
                                        .attach("files", Buffer.from("a"))
                                        .then(res => {
                                            chai.expect(res.status).to.equal(StatusCodes.OK);
                                            done();
                                        });
                                });
                        });
                }); 
        });

        const assertSingleContractStatus = (res, expectedStatus, shouldHaveTimestamp) => {
            chai.expect(res.status).to.equal(StatusCodes.OK);
            chai.expect(res.body).to.haveOwnProperty("contracts");
            const contracts = res.body.contracts;
            chai.expect(contracts).to.have.a.lengthOf(1);
            const contract = contracts[0];
            chai.expect(contract.status).to.equal(expectedStatus);
            chai.expect(!!contract.storageTimestamp).to.equal(!!shouldHaveTimestamp);
            return contracts;
        }

        it("should verify after providing address and then network; should provide timestamp when verifying again", (done) => {
            const agent = chai.request.agent(server.app);
            agent.post("/input-files")
                .attach("files", sourceBuffer)
                .attach("files", metadataBuffer)
                .then(res => {
                    const contracts = assertSingleContractStatus(res, "error");
                    contracts[0].address = contractAddress;

                    agent.post("/verify-validated")
                        .send({ contracts })
                        .then(res => {
                            assertSingleContractStatus(res, "error");
                            contracts[0].chainId = contractChain;

                            agent.post("/verify-validated")
                                .send({ contracts })
                                .then(res => {
                                    assertSingleContractStatus(res, "perfect");
                                    
                                    agent.post("/verify-validated")
                                        .send({ contracts })
                                        .then(res => {
                                            assertSingleContractStatus(res, "perfect", true);
                                            done();
                                        });
                                });
                        });
                });
        });

        it("should fail for a source that is missing and unfetchable", (done) => {
            const agent = chai.request.agent(server.app);
            agent.post("/input-files")
                .attach("files", modifiedMetadataBuffer)
                .then(res => {
                    assertAddressAndChainMissing(res, [], ["browser/1_Storage.sol"]);
                    done();
                });
        });

        it("should fetch missing sources", (done) => {
            const agent = chai.request.agent(server.app);
            agent.post("/input-files")
                .attach("files", metadataBuffer)
                .then(res => {
                    assertAddressAndChainMissing(res, ["browser/1_Storage.sol"], []);
                    done();
                });
        });

        it("should verify after fetching and then providing address+chainId", (done) => {
            const agent = chai.request.agent(server.app);
            agent.post("/input-files")
                .attach("files", metadataBuffer)
                .then(res => {
                    const contracts = assertAddressAndChainMissing(res, ["browser/1_Storage.sol"], []);
                    contracts[0].address = contractAddress;
                    contracts[0].chainId = contractChain;

                    agent.post("/verify-validated")
                        .send({ contracts })
                        .then(res => {
                            assertSingleContractStatus(res, "perfect");
                            done();
                        });
                });
        });
    });
});