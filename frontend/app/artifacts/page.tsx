import { Artifacts } from "@/features/artifacts/Artifacts";
import { type Metadata } from "next";

export const metadata: Metadata = {
  title: "Artifacts",
  description: "Generated files and phase results for download and preview.",
};

export default function ArtifactsPage() {
  return <Artifacts />;
}
