type BrandProps = {
  tone?: "light" | "dark";
  className?: string;
};

// Original SVG artwork from dgtlface.com; source details are in docs/marka-kaynaklari.json.
export function BrandLogo({ tone = "dark", className = "" }: BrandProps) {
  return (
    <img
      className={`brand-logo ${className}`.trim()}
      src={`/brand/dgtlface-logo-${tone === "light" ? "white" : "dark"}.svg`}
      width={220}
      height={55}
      alt="DGTLFACE"
      draggable={false}
    />
  );
}

export function BrandMark({ tone = "light", className = "" }: BrandProps) {
  return (
    <img
      className={`brand-mark ${className}`.trim()}
      src={`/brand/dgtlface-mark-${tone === "light" ? "white" : "dark"}.svg`}
      width={56}
      height={49}
      alt="DGTLFACE"
      draggable={false}
    />
  );
}
