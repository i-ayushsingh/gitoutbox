// Mirror of gitoutbox-core/src/template.rs expansion — shared variables from
// spec §9. The scheduler persists the same expanded string; this is the live
// UI preview only.

export interface TemplateCtx {
  repo: string;
  branch: string;
}

function fileParts(path: string): {
  filename: string;
  stem: string;
  extension: string;
  directory: string;
} {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = idx >= 0 ? path.slice(0, idx) : "";
  const name = idx >= 0 ? path.slice(idx + 1) : path;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot + 1) : "";
  return { filename: name, stem, extension, directory: dir };
}

export function expandTemplate(
  template: string,
  files: { path: string }[],
  ctx: TemplateCtx
): string {
  const isMulti = files.length > 1;
  const first = files[0]?.path ?? "";
  const { filename, stem, extension, directory } = fileParts(first);

  const finalFilename = isMulti ? "[multiple files]" : filename;
  const finalStem = isMulti ? "[multiple stems]" : stem;
  const finalExtension = isMulti ? "[multiple extensions]" : extension;
  const finalDirectory = isMulti ? "[multiple directories]" : directory;
  const finalPath = isMulti ? "[multiple paths]" : first;

  return template
    .replaceAll("{filename}", finalFilename)
    .replaceAll("{stem}", finalStem)
    .replaceAll("{extension}", finalExtension)
    .replaceAll("{directory}", finalDirectory)
    .replaceAll("{path}", finalPath)
    .replaceAll("{file_count}", String(files.length))
    .replaceAll("{repo}", ctx.repo)
    .replaceAll("{branch}", ctx.branch);
}

/// Expand a template for a single file (used in batch one-draft-per-file).
export function expandTemplateSingle(
  template: string,
  filePath: string,
  ctx: TemplateCtx
): string {
  const { filename, stem, extension, directory } = fileParts(filePath);
  return template
    .replaceAll("{filename}", filename)
    .replaceAll("{stem}", stem)
    .replaceAll("{extension}", extension)
    .replaceAll("{directory}", directory)
    .replaceAll("{path}", filePath)
    .replaceAll("{file_count}", "1")
    .replaceAll("{repo}", ctx.repo)
    .replaceAll("{branch}", ctx.branch);
}

export function usesSingleFileVariable(template: string): boolean {
  return (
    template.includes("{filename}") ||
    template.includes("{stem}") ||
    template.includes("{extension}")
  );
}
