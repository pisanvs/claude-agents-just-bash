/**
 * Filesystem export utilities for extracting files from a just-bash sandbox.
 */

import { promises as fsPromises } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import type { Bash } from "just-bash";
import type { ExportedFiles } from "./types.js";

/**
 * Filter paths to only include user-created files, excluding the virtual
 * OS layout created by just-bash (/bin, /usr/bin, /tmp stubs, etc.).
 */
function isUserPath(filePath: string): boolean {
  const excluded = [
    /^\/bin\//,
    /^\/usr\//,
    /^\/dev\//,
    /^\/proc\//,
    /^\/sys\//,
    /^\/etc\/passwd$/,
    /^\/etc\/group$/,
    /^\/etc\/hosts$/,
    /^\/etc\/resolv\.conf$/,
  ];
  return !excluded.some((re) => re.test(filePath));
}

/**
 * Export all text files from the sandbox filesystem.
 *
 * @param bash - The just-bash instance to export from
 * @param pathPrefix - Optional path prefix to filter by (e.g. '/home/user')
 * @returns Object containing text files map and list of binary file paths
 */
export async function exportFiles(
  bash: Bash,
  pathPrefix?: string
): Promise<ExportedFiles> {
  const allPaths = bash.fs.getAllPaths();
  const files: Record<string, string> = {};
  const binaryFiles: string[] = [];

  for (const filePath of allPaths) {
    if (!isUserPath(filePath)) continue;
    if (pathPrefix && !filePath.startsWith(pathPrefix)) continue;

    // Skip directories - getAllPaths() may include them
    try {
      const stat = await bash.fs.stat(filePath);
      if (!stat.isFile) continue;
    } catch {
      continue;
    }

    try {
      const content = await bash.fs.readFile(filePath);
      files[filePath] = content;
    } catch {
      // File is binary or unreadable
      binaryFiles.push(filePath);
    }
  }

  return { files, binaryFiles };
}

/**
 * Export a specific file from the sandbox filesystem.
 *
 * @param bash - The just-bash instance to export from
 * @param filePath - Absolute path to the file inside the sandbox
 * @returns File content as a string
 */
export async function exportFile(bash: Bash, filePath: string): Promise<string> {
  return bash.fs.readFile(filePath);
}

/**
 * Export a specific file from the sandbox filesystem as a Buffer.
 *
 * @param bash - The just-bash instance to export from
 * @param filePath - Absolute path to the file inside the sandbox
 * @returns File content as a Uint8Array
 */
export async function exportFileBuffer(
  bash: Bash,
  filePath: string
): Promise<Uint8Array> {
  return bash.fs.readFileBuffer(filePath);
}

/**
 * Write exported files to a real directory on disk.
 *
 * @param exportedFiles - The exported files from exportFiles()
 * @param outputDir - The output directory path on disk
 * @param options - Options for writing files
 */
export async function writeFilesToDisk(
  exportedFiles: ExportedFiles,
  outputDir: string,
  options: { stripPrefix?: string } = {}
): Promise<void> {
  const resolvedOutputDir = resolve(outputDir);

  for (const [filePath, content] of Object.entries(exportedFiles.files)) {
    let relativePath = filePath;

    // Strip the given prefix if provided (e.g., '/home/user/' -> '')
    if (options.stripPrefix && relativePath.startsWith(options.stripPrefix)) {
      relativePath = relativePath.slice(options.stripPrefix.length);
    }

    // Remove leading slash to make it relative
    relativePath = relativePath.replace(/^\/+/, "");

    if (!relativePath) continue;

    // Reject any attempt to traverse outside the output directory
    const segments = relativePath.split(/[\\/]+/);
    if (segments.some((segment) => segment === "..")) {
      throw new Error(
        `Refusing to write file with unsafe relative path containing '..': ${relativePath}`
      );
    }

    const destPath = resolve(resolvedOutputDir, relativePath);

    // Ensure the resolved destination path is within the output directory
    if (
      destPath !== resolvedOutputDir &&
      !destPath.startsWith(resolvedOutputDir + sep)
    ) {
      throw new Error(
        `Refusing to write file outside of output directory: ${destPath}`
      );
    }

    const destDir = dirname(destPath);

    if (destDir) {
      await fsPromises.mkdir(destDir, { recursive: true });
    }

    await fsPromises.writeFile(destPath, content, "utf8");
  }
}
