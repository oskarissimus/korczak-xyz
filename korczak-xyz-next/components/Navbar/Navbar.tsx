"use client";
import React, { useState } from "react";

import MainNavMenu from "./MainNavMenu";
import MobileNavHeader from "./MobileNavHeader";

interface NavbarProps {}

const Navbar: React.FC<NavbarProps> = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <div className="flex flex-col border-b md:border-b-0 border-gray-400 sticky md:relative top-0 left-0 w-full z-30 md:max-w-6xl bg-white dark:bg-black mr-10 lg:text-lg">
      <MobileNavHeader setIsMenuOpen={setIsMenuOpen} />
      <MainNavMenu isMenuOpen={isMenuOpen} />
    </div>
  );
};

export default Navbar;
