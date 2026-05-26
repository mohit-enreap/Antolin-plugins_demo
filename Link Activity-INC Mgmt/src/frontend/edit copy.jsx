import React, { useState, useEffect, useCallback } from "react";
import ForgeReconciler, {
  Label,
  Text,
  Link,
  Select,
  RequiredAsterisk,
  HelperMessage,
  useProductContext,
  ErrorMessage,
} from "@forge/react";
import { CustomFieldEdit } from "@forge/react/jira";
import { view, invoke, requestJira } from "@forge/bridge"; // Added requestJira

// Moved base options outside to prevent recreation
const baseIncidentOptions = [
  { label: "GUIDES & STDS (Re-Work)", value: "GUIDES & STDS (Re-Work)" },
  { label: "DESIGN CRITERIA (Re-Work)", value: "DESIGN CRITERIA (Re-Work)" },
  { label: "QUALITY GATES", value: "QUALITY GATES" },
  { label: "MUA FORMAL (Extra Work)", value: "MUA FORMAL (Extra Work)" },
  { label: "MUA INFORMAL (Extra Work)", value: "MUA INFORMAL (Extra Work)" },
  { label: "SW & HW", value: "SW & HW" },
  { label: "RESOURCES", value: "RESOURCES" },
];

const Edit = () => {
  const [value, setValue] = useState("");
  const [renderContext, setRenderContext] = useState(null);
  const [incidentOptions, setIncidentOptions] = useState(baseIncidentOptions); // Dynamic options state
  const [selectOptions, setSelectOptions] = useState([]);
  const [selectActivityOptions, setSelectActivityOptions] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [incidentType, setIncidentType] = useState(null);
  const [isActivityLoading, setIsActivityLoading] = useState(false);

  // Error states
  const [projectError, setProjectError] = useState(true);
  const [incidentError, setIncidentError] = useState(true);

  const context = useProductContext();

  const showActivity = (incident) =>
    [
      "GUIDES & STDS (Re-Work)",
      "DESIGN CRITERIA (Re-Work)",
      "MUA FORMAL (Extra Work)",
      "MUA INFORMAL (Extra Work)",
    ].includes(incident);

  const fetchIssuesByJQL = async (jql) => {
    try {
      const response = await invoke("getIssuesByJQL", { jql });
      return response.issues || [];
    } catch (error) {
      console.error("Error fetching issues:", error);
      return [];
    }
  };

  useEffect(() => {
    const initialize = async () => {
      const contextData = await view.getContext();
      const fieldVal = contextData.extension.fieldValue?.toString() || "";
      const currentRenderContext = contextData.extension.renderContext;

      setRenderContext(currentRenderContext);
      setValue(fieldVal);

      // --- NEW LOGIC: Dynamic option filtering ---
      let dynamicOptions = [...baseIncidentOptions];

      if (currentRenderContext === "issue-create") {
        // Exclude Re-Work and Extra Work during issue creation
        dynamicOptions = baseIncidentOptions.filter(
          (opt) =>
            !opt.value.includes("(Re-Work)") &&
            !opt.value.includes("(Extra Work)"),
        );
      } else {
        // Edit/Transition screen: Fetch issue summary to filter options
        const issueId = contextData.extension.issue?.id;
        if (issueId) {
          try {
            const res = await requestJira(
              `/rest/api/3/issue/${issueId}?fields=summary`,
            );
            if (res.ok) {
              const issueData = await res.json();
              const summary = (issueData.fields?.summary || "").toLowerCase();

              if (summary.includes("extra work")) {
                dynamicOptions = baseIncidentOptions.filter((opt) =>
                  opt.value.includes("(Extra Work)"),
                );
              } else if (
                summary.includes("rework") ||
                summary.includes("re-work")
              ) {
                dynamicOptions = baseIncidentOptions.filter((opt) =>
                  opt.value.includes("(Re-Work)"),
                );
              }
            }
          } catch (err) {
            console.error("Failed to fetch issue summary", err);
          }
        }
      }

      setIncidentOptions(dynamicOptions);
      // -------------------------------------------

      const [projectKey, project, incident, activityLabel, activityKey] =
        fieldVal.split("##");

      if (incident) {
        // Match against base options to ensure existing valid selections render correctly
        const selected = baseIncidentOptions.find(
          (opt) => opt.value === incident,
        );
        if (selected) setIncidentType(selected);
      }

      if (
        currentRenderContext !== "issue-create" &&
        (!incident ||
          (showActivity(incident) &&
            (activityKey == undefined ||
              activityKey == "" ||
              activityKey == null)))
      ) {
        await view.submit(null);
      }

      if (project) {
        setSelectedProject({ label: project, value: project, key: projectKey });
      }

      const projectJQL = `"type" = Project ORDER BY key ASC`;
      const projectIssues = await fetchIssuesByJQL(projectJQL);
      const projectOptions = projectIssues.map((issue) => ({
        label: issue.fields.summary,
        value: issue.fields.summary,
        key: issue.key,
      }));
      setSelectOptions(projectOptions);

      if (project && incident && showActivity(incident)) {
        const keyword = incident.includes("Extra Work")
          ? "Extra Work"
          : "Re-Work";
        const activityJQL = `"type" = Activity AND "Project Name[Short text]" ~ "${project.replace(/-/g, " ")}" AND summary ~ "${keyword}" AND Project = CWO ORDER BY summary ASC`;
        const activityIssues = await fetchIssuesByJQL(activityJQL);
        const activityOptions = activityIssues.map((issue) => ({
          label: `${issue.fields.customfield_10970} | ${issue.fields.summary}`,
          value: issue.key,
        }));
        setSelectActivityOptions(activityOptions);

        if (activityKey) {
          const matched = activityOptions.find(
            (opt) => opt.value === activityKey,
          );
          if (matched) {
            setSelectedActivity(matched);
          }
        }
      }
    };

    initialize();
  }, [context]);

  useEffect(() => {
    const loadActivities = async () => {
      if (incidentType) setIncidentError(false);
      if (selectedProject) setProjectError(false);

      if (incidentType && selectedProject && showActivity(incidentType.value)) {
        setIsActivityLoading(true);

        const keyword = incidentType.value.includes("Extra Work")
          ? "Extra Work"
          : "Re-Work";
        const activityJQL = `"type" = Activity AND "Project Name[Short text]" ~ "${selectedProject.value.replace(/-/g, " ")}" AND summary ~ "${keyword}" AND Project = CWO ORDER BY summary ASC`;

        const activityIssues = await fetchIssuesByJQL(activityJQL);
        const activityOptions = activityIssues.map((issue) => ({
          label: `${issue.fields.customfield_10970} | ${issue.fields.summary}`,
          value: issue.key,
        }));
        setSelectActivityOptions(activityOptions);
        setIsActivityLoading(false);
      } else {
        setSelectActivityOptions([]);
        setIsActivityLoading(false);
      }
    };

    loadActivities();
  }, [incidentType, selectedProject]);

  const onSubmit = async () => {
    try {
      setProjectError(false);
      setIncidentError(false);

      let hasError = false;
      if (!selectedProject) {
        setProjectError(true);
        hasError = true;
        await view.submit(null);
        return;
      }
      if (!incidentType) {
        setIncidentError(true);
        hasError = true;
        await view.submit(null);
        return;
      }

      if (
        renderContext !== "issue-create" &&
        showActivity(incidentType.value) &&
        !selectedActivity
      ) {
        await view.submit(null);
        return;
      }

      const valueToSave = `${selectedProject?.key || ""}##${
        selectedProject?.value || ""
      }##${incidentType?.value || ""}##${selectedActivity?.label || ""}##${
        selectedActivity?.value || ""
      }`;
      await view.submit(valueToSave);
    } catch (e) {
      console.error("Submit error:", e);
    }
  };

  const handleIncidentChange = useCallback((option) => {
    setIncidentType(option);
    setSelectedActivity(null);
    setSelectActivityOptions([]);
    setIncidentError(false);
  }, []);

  const handleProjectChange = useCallback((option) => {
    setSelectedProject(option);
    setSelectedActivity(null);
    setSelectActivityOptions([]);
    setProjectError(false);
  }, []);

  const handleActivityChange = useCallback((option) => {
    setSelectedActivity(option);
  }, []);

  return (
    <CustomFieldEdit onSubmit={onSubmit} hideActionButtons>
      <Text></Text>
      <Text></Text>

      <Label>
        Project <RequiredAsterisk />
      </Label>
      <Select
        placeholder="Select Project ..."
        options={selectOptions}
        onChange={handleProjectChange}
        value={selectedProject}
        isLoading={selectOptions.length === 0}
      />
      {projectError && (
        <ErrorMessage>
          Project is required. Please select a project.
        </ErrorMessage>
      )}
      <HelperMessage>Select a project to view activities</HelperMessage>
      <Text></Text>

      <Label>
        Incident Type <RequiredAsterisk />
      </Label>
      <Select
        placeholder="Select Incident Type..."
        options={incidentOptions} // Now using the dynamically filtered state variable
        onChange={handleIncidentChange}
        value={incidentType}
      />
      {incidentError && (
        <ErrorMessage>
          Incident type is required. Please select one.
        </ErrorMessage>
      )}
      <HelperMessage>
        For the incident type guide, refer to the link below.
        <Text></Text>
        <Link
          href="https://grupoantolin.sharepoint.com/sites/App_Monitoring/CET/INCIDENCES/Issue%20types_02-Jan-2026.xlsx"
          openNewTab={true}
        >
          Guide
        </Link>
      </HelperMessage>
      <Text></Text>

      {incidentType?.value && showActivity(incidentType.value) && (
        <>
          <Label>
            Activity {renderContext !== "issue-create" && <RequiredAsterisk />}
          </Label>
          <Select
            placeholder="Select Activity ..."
            options={selectActivityOptions}
            onChange={handleActivityChange}
            value={selectedActivity}
            isDisabled={!selectedProject}
            isLoading={isActivityLoading}
          />
          <HelperMessage>
            Select an activity for the selected incident type
          </HelperMessage>
        </>
      )}
    </CustomFieldEdit>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Edit />
  </React.StrictMode>,
);
