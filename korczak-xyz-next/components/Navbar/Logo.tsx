import Image from "next/image";
import React from "react";

import MenuItem from "@/components/MenuItem";
import logo from "@/public/logo.png";

interface LogoProps {
  className?: string;
  name?: string;
}

const Logo: React.FC<LogoProps> = ({
  className = "",
  name = "korczak.xyz",
}) => {
  return (
    <div className={`flex gap-3 ${className}`} data-testid="logo">
      <Image src={logo} alt="logo" width={30} height={30} />
      <MenuItem name={name} to="/" />
    </div>
  );
};

export default Logo;
export type { LogoProps };
