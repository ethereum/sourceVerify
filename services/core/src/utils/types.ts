import Web3 from "web3";
import { CheckedContract } from "./CheckedContract";

export interface FileObject {
    name: string,
    path: string
    content?: string
  }

export interface InputData {
    chain: string,
    addresses: string[],
    contract?: CheckedContract,
    bytecode?: string
}

export interface CompilationSettings {
  compilationTarget: any;
  outputSelection: any;
}

export interface CompilerInfo {
  version: string;
}

export interface Metadata {
  sources: any;
  settings: CompilationSettings;
  compiler: CompilerInfo;
}

export declare interface StringMap {
  [key: string]: string;
}

export interface PathBuffer {
  path?: string;
  buffer: Buffer;
}

export interface PathContent {
  path?: string;
  content: string;
}

export interface SourceMap {
  [compiledPath: string]: PathContent;
}

export interface Match {
  address: string | null,
  status: 'perfect' | 'partial' | null,
  storageTimestamp?: Date,
  message?: string
}

/**
 * A type for specfifying the strictness level of querying (only full or any kind of matches)
 */
export type MatchLevel = "full_match" | "any_match";

/**
 * A type for specifying the match quality of files.
 */
export type MatchQuality = "full" | "partial";

/**
 * An array wrapper with info properties.
 */
export type FilesInfo<T> = { status: MatchQuality, files: Array<T> };

export interface MonitorConfig {
  repository? : string,
  testing?: boolean
}

export declare interface StringToBooleanMap {
  [key: string]: boolean;
}

export type Tag = {
  timestamp: any,
  repositoryVersion: string
}