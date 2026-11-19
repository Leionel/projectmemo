import Image from "next/image";
import { BOOKMARK_SPIRIT_ASSETS } from "@/lib/mascot/bookmarkSpirit";

export function BookmarkSpiritIcon({ size = 32 }: { size?: number }) {
  return <Image src={BOOKMARK_SPIRIT_ASSETS.avatar.web} width={size} height={size} alt="" unoptimized />;
}
