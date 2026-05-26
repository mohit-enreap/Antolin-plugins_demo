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
import { view, invoke } from "@forge/bridge";

const Edit = () => {
  const [value, setValue] = useState("");
  const [renderContext, setRenderContext] = useState(null);
  const [selectOptions, setSelectOptions] = useState([]);
  const [selectActivityOptions, setSelectActivityOptions] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [incidentType, setIncidentType] = useState(null);
  const [isActivityLoading, setIsActivityLoading] = useState(false);

  // New error states
  const [projectError, setProjectError] = useState(true);
  const [incidentError, setIncidentError] = useState(true);
  // const [activityError, setActivityError] = useState(false);

  const context = useProductContext();

  const incidentTypeOptions = [
    { label: "GUIDES & STDS (Re-Work)", value: "GUIDES & STDS (Re-Work)" },
    { label: "DESIGN CRITERIA (Re-Work)", value: "DESIGN CRITERIA (Re-Work)" },
    { label: "QUALITY GATES", value: "QUALITY GATES" },
    { label: "MUA FORMAL (Extra Work)", value: "MUA FORMAL (Extra Work)" },
    { label: "MUA INFORMAL (Extra Work)", value: "MUA INFORMAL (Extra Work)" },
    { label: "SW & HW", value: "SW & HW" },
    { label: "RESOURCES", value: "RESOURCES" },
  ];

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
      setRenderContext(contextData.extension.renderContext);
      setValue(fieldVal);

      const [projectKey, project, incident, activityLabel, activityKey] =
        fieldVal.split("##");

      if (incident) {
        const selected = incidentTypeOptions.find(
          (opt) => opt.value === incident
        );
        if (selected) setIncidentType(selected);
      }

      // Note: your existing submit/cancel logic kept as-is.
      console.log(incident, !incident, showActivity(incident), !activityKey);
      if (
        contextData.extension.renderContext !== "issue-create" &&
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
        const activityJQL = `"type" = Activity AND "Project Name[Short text]" ~ "${project}" AND summary ~ "${keyword}" AND Project = CWO ORDER BY summary ASC`;
        // const activityJQL = `"type" = Activity AND "Project Name[Short text]" ~ "${project}" AND Project = CWO ORDER BY summary ASC`;
        const activityIssues = await fetchIssuesByJQL(activityJQL);
        const activityOptions = activityIssues.map((issue) => ({
          label: `${issue.fields.customfield_10970} | ${issue.fields.summary}`,
          value: issue.key,
        }));
        setSelectActivityOptions(activityOptions);

        if (activityKey) {
          const matched = activityOptions.find(
            (opt) => opt.value === activityKey
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
        setIsActivityLoading(true); // Start loading

        const keyword = incidentType.value.includes("Extra Work")
          ? "Extra Work"
          : "Re-Work";
        const activityJQL = `"type" = Activity AND "Project Name[Short text]" ~ "${selectedProject.value}" AND summary ~ "${keyword}" AND Project = CWO ORDER BY summary ASC`;
        // const activityJQL = `"type" = Activity AND "Project Name[Short text]" ~ "${selectedProject.value}" AND Project = CWO ORDER BY summary ASC`;

        const activityIssues = await fetchIssuesByJQL(activityJQL);
        const activityOptions = activityIssues.map((issue) => ({
          label: `${issue.fields.customfield_10970} | ${issue.fields.summary}`,
          value: issue.key,
        }));
        setSelectActivityOptions(activityOptions);
        setIsActivityLoading(false); // Done
      } else {
        setSelectActivityOptions([]);
        setIsActivityLoading(false); // Done
      }
    };

    loadActivities();
  }, [incidentType, selectedProject]);

  const onSubmit = async () => {
    try {
      // reset errors
      setProjectError(false);
      setIncidentError(false);
      // setActivityError(false);

      // basic validation
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
    setIncidentError(false); // clear error when user chooses
  }, []);

  const handleProjectChange = useCallback((option) => {
    setSelectedProject(option);
    setSelectedActivity(null);
    setSelectActivityOptions([]);
    setProjectError(false); // clear error when user chooses
  }, []);

  const handleActivityChange = useCallback((option) => {
    setSelectedActivity(option);
    // setActivityError(false); // clear activity error when chosen
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
        options={incidentTypeOptions}
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
          // href="https://docs.google.com/spreadsheets/d/1hyUDqmCp-qaN49aKj5WXNr-e5_ibiJdN0BLwwxnAJkQ/edit?gid=0#gid=0" // OLD
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
  </React.StrictMode>
);
