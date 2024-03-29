import React from "react";

import MenuItem from "@/components/MenuItem";

interface NavigationItemsProps {
  navigation: { name: string; to: string }[];
}

const NavigationItems: React.FC<NavigationItemsProps> = ({ navigation }) => {
  return (
    <>
      {navigation.map((item) => (
        <MenuItem key={item.name} {...item} />
      ))}
    </>
  );
};

export default NavigationItems;
export type { NavigationItemsProps };
