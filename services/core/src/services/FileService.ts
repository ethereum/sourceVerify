import dirTree from 'directory-tree';
import Path from 'path';
import fs from 'fs';
import web3 from 'web3';
import * as bunyan from 'bunyan';
import { FileObject, Match, Tag, MatchLevel, FilesInfo } from '../utils/types';
import { getChainId } from '../utils/utils';
import { Logger } from '../utils/logger';

export interface IFileService {
    getTreeByChainAndAddress(chainId: any, address: string): Promise<Array<string>>;
    getByChainAndAddress(chainId: any, address: string): Promise<Array<FileObject>>;
    fetchAllFileUrls(chain: string, address: string): Array<string>;
    fetchAllFilePaths(chain: string, address: string): Array<FileObject>;
    fetchAllFileContents(chain: string, address: string): Array<FileObject>;
    findByAddress(address: string, chain: string, repository: string): Match[];
    repositoryPath: string;
    getTree(chainId: any, address: string, match: string): Promise<FilesInfo<string>>;
    getContent(chainId: any, address: string, match: string): Promise<FilesInfo<FileObject>>;
}

export class FileService implements IFileService {
    logger: bunyan;
    repositoryPath: string;

    constructor(repositoryPath: string, logger?: bunyan) {
        this.logger = logger || Logger("FileService");
        this.repositoryPath = repositoryPath;
    }

    async getTreeByChainAndAddress(chainId: any, address: string): Promise<string[]> {
        chainId = getChainId(chainId);
        return this.fetchAllFileUrls(chainId, address);
    }

    async getByChainAndAddress(chainId: any, address: string): Promise<FileObject[]> {
        chainId = getChainId(chainId);
        return this.fetchAllFileContents(chainId, address);
    }

    fetchAllFileUrls(chain: string, address: string, match = "full_match"): Array<string> {
        const files: Array<FileObject> = this.fetchAllFilePaths(chain, address, match);
        const urls: Array<string> = [];
        files.forEach((file) => {
            const relativePath = file.path.split('/repository')[1].substr(1);
            urls.push(`${process.env.REPOSITORY_URL}/${relativePath}`);
        });
        return urls;
    }

    fetchAllFilePaths(chain: string, address: string, match = "full_match"): Array<FileObject> {
        const fullPath: string = this.repositoryPath + `/contracts/${match}/${chain}/${web3.utils.toChecksumAddress(address)}/`;
        const files: Array<FileObject> = [];
        dirTree(fullPath, {}, (item) => {
            files.push({ "name": item.name, "path": item.path });
        });
        return files;
    }

    fetchAllFileContents(chain: string, address: string, match = "full_match"): Array<FileObject> {
        const files = this.fetchAllFilePaths(chain, address, match);
        for (const file in files) {
            const loadedFile = fs.readFileSync(files[file].path)
            files[file].content = loadedFile.toString();
        }

        return files;
    }
    
    getTree = async (chainId: any, address: string, match: MatchLevel): Promise<FilesInfo<string>> => {
        chainId = getChainId(chainId);
        const fullMatchesTree = this.fetchAllFileUrls(chainId, address, "full_match");
        if (fullMatchesTree.length || match === "full_match") {
            return { status: "full", files: fullMatchesTree };
        }

        const files = this.fetchAllFileUrls(chainId, address, "partial_match");
        return { status: "partial", files };
    }

    getContent = async (chainId: any, address: string, match: MatchLevel): Promise<FilesInfo<FileObject>> => {
        chainId = getChainId(chainId);
        const fullMatchesFiles = this.fetchAllFileContents(chainId, address, "full_match");
        if (fullMatchesFiles.length || match === "full_match") {
            return { status: "full", files: fullMatchesFiles };
        }

        const files = this.fetchAllFileContents(chainId, address, "partial_match");
        return { status: "partial", files };
    }

    /**
     * Only for checking that files exists in path
     * @param address
     * @param chain
     * @param repository
     */
    findByAddress(address: string, chain: string, repository: string): Match[] {
        const addressPath = `${repository}/contracts/full_match/${chain}/${web3.utils.toChecksumAddress(address)}/metadata.json`;

        try {
            const storageTimestamp = fs.statSync(addressPath).birthtime;
            return [{
                address: address,
                status: "perfect",
                storageTimestamp
            }];
        } catch (e) {
            throw new Error("Address not found in repository");
        }
    }

    /**
     * Save file and update the repository tag
     *
     * @param path
     * @param file
     */
    save(path: string, file: any) {
        fs.mkdirSync(Path.dirname(path), { recursive: true });
        fs.writeFileSync(path, file);
        this.updateRepositoryTag();
    }

    /**
     * Update repository tag
     */
    updateRepositoryTag() {
        const filePath: string = Path.join(this.repositoryPath, 'manifest.json')
        const timestamp = new Date().getTime();
        const repositoryVersion = process.env.REPOSITORY_VERSION || '0.1';
        const tag: Tag = {
            timestamp: timestamp,
            repositoryVersion: repositoryVersion
        }
        fs.writeFileSync(filePath, JSON.stringify(tag));
    }

}
