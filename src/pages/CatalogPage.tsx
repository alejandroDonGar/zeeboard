import { useState } from "react";
import { Segmented } from "../components/BoardFilters";
import TemplatesPage from "./TemplatesPage";
import TagsPage from "./TagsPage";

type Tab = "types" | "tags";

/** Templates and tags in one screen: the type of commission (template, with its colour) and the extras (tags). */
function CatalogPage() {
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem("zeeboard-catalog-tab") === "tags" ? "tags" : "types"));

  function choose(next: Tab) {
    setTab(next);
    sessionStorage.setItem("zeeboard-catalog-tab", next);
  }

  const tabs = (
    <Segmented
      options={[
        { value: "types", label: "Commission types" },
        { value: "tags", label: "Tags" },
      ]}
      value={tab}
      onChange={choose}
    />
  );

  return tab === "types" ? <TemplatesPage tabs={tabs} /> : <TagsPage tabs={tabs} />;
}

export default CatalogPage;
