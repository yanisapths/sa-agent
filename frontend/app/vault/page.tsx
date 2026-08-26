import { Vault } from "@/features/vault/Vault";
import { type Metadata } from "next";

export const metadata: Metadata = {
  title: "Vault",
  description: "Knowledge library for project files, requirements, and code.",
};

export default function VaultPage() {
  return <Vault />;
}
