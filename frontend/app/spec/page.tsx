import { SpecDesignAgent } from "@/features/spec-design/SpecDesignAgent";
import { type Metadata } from "next";

export const metadata: Metadata = {
  title: "Spec Design Agent",
  description: "Generate API spec results as JSON from chat, files, and images.",
};

export default function SpecPage() {
  return <SpecDesignAgent />;
}
