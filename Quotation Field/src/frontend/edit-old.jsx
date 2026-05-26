import React, { useState, useEffect, useCallback } from "react";
import ForgeReconciler, { Select, useProductContext } from "@forge/react";
import { CustomFieldEdit } from "@forge/react/jira";
import { view, invoke } from "@forge/bridge";

const Edit = () => {
  const [value, setValue] = useState("");
  const [selectOptions, setSelectOptions] = useState([]);
  const context = useProductContext(); // Retrieve the issue context

  // Function to fetch issues using JQL
  const fetchIssuesByJQL = async (jql) => {
    try {
      const response = await invoke("getIssuesByJQL", { jql });
      console.log(response);
      return response.issues || [];
    } catch (error) {
      console.error("Error fetching issues:", error);
      return [];
    }
  };

  // Fetch issues and set options
  useEffect(() => {
    const initializeSelectOptions = async () => {
      const issueKey = "Quotation";
      const jql = `\"type\" = ${issueKey}`; // Modify as needed  JQL Type=Quotation and Status Approved
      const issues = await fetchIssuesByJQL(jql);

      const options = issues.map((issue) => ({
        label: `${issue.fields.summary}`,
        value: `${issue.key}`,
      }));

      setSelectOptions(options);
    };

    initializeSelectOptions();
  }, [context]);

  const onSubmit = useCallback(async () => {
    try {
      await view.submit(value);
    } catch (e) {
      console.error(e);
    }
  }, [value]);

  const handleOnChange = useCallback((selectedOption) => {
    setValue(selectedOption.label);
  }, []);

  return (
    <CustomFieldEdit onSubmit={onSubmit} hideActionButtons>
      <Select
        appearance="default"
        options={selectOptions}
        onChange={handleOnChange}
        isLoading={selectOptions.length === 0} // Show loading state if options are empty
      />
    </CustomFieldEdit>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Edit />
  </React.StrictMode>,
);
