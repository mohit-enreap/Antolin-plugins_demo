import React, { useState, useEffect, useCallback } from "react";
// Added Label and Stack to the imports
import ForgeReconciler, {
  Select,
  Stack,
  Text,
  useProductContext,
} from "@forge/react";
import { CustomFieldEdit } from "@forge/react/jira";
import { view, invoke } from "@forge/bridge";

const Edit = () => {
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [issueOptions, setIssueOptions] = useState([]);
  const [versionOptions, setVersionOptions] = useState([]);

  const context = useProductContext();

  useEffect(() => {
    const initializeOptions = async () => {
      const jql = 'type = "Quotation"';
      try {
        const response = await invoke("getIssuesByJQL", { jql });
        const issues = response.issues || [];

        const options = issues.map((issue) => ({
          label: issue.fields.summary,
          value: issue.key,
          versions: issue.fields.customfield_12257,
        }));

        setIssueOptions(options);
      } catch (error) {
        console.error("Error initializing options:", error);
      }
    };

    initializeOptions();
  }, [context]);

  const handleIssueChange = useCallback((option) => {
    setSelectedIssue(option);
    setSelectedVersion(null);

    if (option && option.versions) {
      try {
        // Handle both JSON string or raw Array
        const versions =
          typeof option.versions === "string"
            ? JSON.parse(option.versions)
            : option.versions;

        setVersionOptions(versions.map((v) => ({ label: v, value: v })));
      } catch (e) {
        console.error("Error parsing versions:", e);
        setVersionOptions([]);
      }
    } else {
      setVersionOptions([]);
    }
  }, []);

  const onSubmit = useCallback(async () => {
    if (selectedIssue && selectedVersion) {
      // Storing as a combined string for the single Jira field
      const finalValue = `${selectedIssue.label} ## ${selectedIssue.value} ## ${selectedVersion.value}`;
      await view.submit(finalValue);
    }
  }, [selectedIssue, selectedVersion]);

  return (
    <CustomFieldEdit onSubmit={onSubmit} hideActionButtons>
      {/* Stack provides the spacing between elements without needing Box */}
      <Stack space="space.200">
        <Stack space="space.050">
          <Text fontWeight="bold">Quotation Reference</Text>
          <Select
            options={issueOptions}
            onChange={handleIssueChange}
            placeholder="Select a Quotation..."
            isLoading={issueOptions.length === 0}
          />
        </Stack>

        {versionOptions.length > 0 && (
          <Stack space="space.050">
            <Text fontWeight="bold">Quotation Version</Text>
            <Select
              options={versionOptions}
              onChange={(opt) => setSelectedVersion(opt)}
              placeholder="Select Version..."
            />
          </Stack>
        )}
      </Stack>
    </CustomFieldEdit>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Edit />
  </React.StrictMode>,
);
