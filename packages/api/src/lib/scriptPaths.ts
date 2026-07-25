import fs from 'fs';
import path from 'path';
import { prisma } from './prisma.js';

/**
 * Resolves the on-disk script path for each test case, trying (in order):
 * hierarchy layout under the project slug, legacy flat layout under the
 * slug's scripts/ dir, sourceRef-relative path under the slug, and finally
 * the raw projectId (cuid) directory for older imports. Restores from DB
 * content if nothing is found on disk but the script content exists.
 */
export async function resolveScriptPaths(
  projectId: string,
  testCaseIds: string[],
): Promise<{ testCaseId: string; scriptPath: string }[]> {
  const [project, scripts] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { slug: true } }),
    prisma.script.findMany({
      where: { projectId, testCaseId: { in: testCaseIds } },
      select: {
        testCaseId: true,
        filename: true,
        content: true,
        testCase: { select: { sourceRef: true } },
      },
    }),
  ]);
  const SCRIPTS_ROOT = process.env.SCRIPTS_ROOT ?? '/scripts';

  const results: { testCaseId: string; scriptPath: string }[] = [];

  for (const s of scripts.filter((s): s is typeof s & { testCaseId: string } => s.testCaseId !== null)) {
    const slug = project?.slug ?? projectId;
    // Hierarchy import: filename is a relative path (e.g. TestCases/foo/TC01.robot)
    const slugRootPath    = `${SCRIPTS_ROOT}/${slug}/${s.filename}`;
    // Legacy flat import: filename is just a basename (e.g. TC01.robot) under scripts/ subdir
    const slugScriptsPath = `${SCRIPTS_ROOT}/${slug}/scripts/${s.filename}`;
    const cuidPath        = `${SCRIPTS_ROOT}/${projectId}/${s.filename}`;
    const sourceRef = s.testCase?.sourceRef;
    const sourceRefPath = sourceRef ? `${SCRIPTS_ROOT}/${slug}/${sourceRef}` : null;

    if (fs.existsSync(slugRootPath)) {
      // Hierarchy layout — file lives at project root with full relative path preserved
      results.push({ testCaseId: s.testCaseId, scriptPath: slugRootPath });
    } else if (fs.existsSync(slugScriptsPath)) {
      results.push({ testCaseId: s.testCaseId, scriptPath: slugScriptsPath });
    } else if (fs.existsSync(cuidPath)) {
      results.push({ testCaseId: s.testCaseId, scriptPath: cuidPath });
    } else if (sourceRefPath && fs.existsSync(sourceRefPath)) {
      results.push({ testCaseId: s.testCaseId, scriptPath: sourceRefPath });
    } else if (s.content) {
      // Script is in the DB but not on disk — restore it to the appropriate location.
      const isHierarchy = s.filename.includes('/');
      const restorePath = isHierarchy ? slugRootPath : slugScriptsPath;
      fs.mkdirSync(path.dirname(restorePath), { recursive: true });
      fs.writeFileSync(restorePath, s.content, 'utf-8');
      results.push({ testCaseId: s.testCaseId, scriptPath: restorePath });
    } else {
      // No content anywhere — runner will fail with a clear file-not-found error.
      results.push({ testCaseId: s.testCaseId, scriptPath: slugRootPath });
    }
  }

  return results;
}
