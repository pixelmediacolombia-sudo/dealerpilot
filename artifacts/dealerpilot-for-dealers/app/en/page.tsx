import type { Metadata } from "next";
import { DealerLanding } from "../page";

export const metadata: Metadata = {
  title: "DealerPilot for dealers | Commercial operations in one place",
  description: "DealerPilot connects inventory, Marketplace, and buyer conversations.",
  alternates: { canonical: "/en" },
};

export default function EnglishHome() { return <DealerLanding locale="en" />; }
