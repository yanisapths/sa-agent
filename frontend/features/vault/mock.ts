import { type VaultFolder, type VaultMention } from "./types";

export function toMentionToken(folderName: string, fileName?: string): string {
  const folder = folderName.trim().replace(/\s+/g, "-");
  return fileName ? `@${folder}/${fileName}` : `@${folder}`;
}

export function buildMentions(folders: VaultFolder[]): VaultMention[] {
  return folders.flatMap((folder) => [
    {
      token: toMentionToken(folder.name),
      label: folder.name,
      kind: "folder" as const,
      folderId: folder.id,
      fileId: null,
    },
    ...folder.files.map((file) => ({
      token: toMentionToken(folder.name, file.name),
      label: `${folder.name} / ${file.name}`,
      kind: "file" as const,
      folderId: folder.id,
      fileId: file.id,
    })),
  ]);
}

export const MOCK_FOLDERS: VaultFolder[] = [
  {
    id: "fld_req",
    name: "Requirements",
    description: "Product and business requirement docs",
    files: [
      {
        id: "fil_prd",
        name: "prd.md",
        size: 12400,
        mimeType: "text/markdown",
      },
      {
        id: "fil_stories",
        name: "user-stories.md",
        size: 8200,
        mimeType: "text/markdown",
      },
    ],
  },
  {
    id: "fld_code",
    name: "Code",
    description: "Reference snippets and existing services",
    files: [
      {
        id: "fil_chat",
        name: "chat-api.ts",
        size: 4100,
        mimeType: "text/typescript",
      },
    ],
  },
  {
    id: "fld_res",
    name: "Resources",
    description: "Diagrams, SQL, and shared notes",
    files: [
      {
        id: "fil_er",
        name: "er-diagram.png",
        size: 220000,
        mimeType: "image/png",
      },
    ],
  },
];

export const vaultMentions = buildMentions(MOCK_FOLDERS);
