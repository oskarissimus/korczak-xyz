import React from "react";

function t(key: string) {
  return key;
}

function useMainNavMenuData() {
  // const { languages, originalPath } = useI18next();
  // const { t } = useTranslation();

  const navigation = React.useMemo(
    () => [
      { name: t("Home"), to: "/" },
      { name: t("About"), to: "/about" },
      { name: t("Mentoring"), to: "/mentoring" },
      { name: t("Courses"), to: "/courses" },
      { name: t("Blog"), to: "/blog" },
    ],
    []
  );

  return { navigation };
}

export default useMainNavMenuData;
