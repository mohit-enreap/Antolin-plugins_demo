import React, { useState, useEffect, useCallback } from 'react';
import ForgeReconciler, { Select, HelperMessage, useProductContext } from '@forge/react';
import { CustomFieldEdit } from '@forge/react/jira';
import { view, invoke } from '@forge/bridge';

const Edit = () => {
  const [value, setValue] = useState('');
  const [renderContext, setRenderContext] = useState(null);
  const [selectOptions, setSelectOptions] = useState([]);
  const [selectActivityOptions, setSelectActivityOptions] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedActivity, setSelectedActivity] = useState(null);

  const context = useProductContext();

  // Fetch issues using JQL
  const fetchIssuesByJQL = async (jql) => {
    try {
      const response = await invoke('getIssuesByJQL', { jql });
      return response.issues || [];
    } catch (error) {
      console.error('Error fetching issues:', error);
      return [];
    }
  };

  // Initial load
  useEffect(() => {
    const initialize = async () => {
      const contextData = await view.getContext();
      const fieldVal = contextData.extension.fieldValue ?.toString() || '';
      console.log("field VAlue -> ", fieldVal)
      setRenderContext(contextData.extension.renderContext);
      setValue(fieldVal);

      
      const [project, activity,activityKey] = fieldVal.split('##');
      console.log("Activity ->", activity, activityKey)
      if (renderContext !== 'issue-create' && (activityKey==undefined || activityKey=="" || activityKey==null)) {
        console.log('Condition met: renderContext is "issue-view" and Activity is NOT selected');
        console.log('Submitting NULL value...');
        await view.submit(null);
      }
      // Set selected project dropdown value
      if (project) {
        setSelectedProject({ label: project, value: project });
      }

      const projectJQL = `"type" = Project ORDER BY key ASC`;
      const projectIssues = await fetchIssuesByJQL(projectJQL);
      const projectOptions = projectIssues.map(issue => ({
        label: issue.fields.summary,
        value: issue.fields.summary,
      }));
      setSelectOptions(projectOptions);

      // If project was pre-filled, fetch activities for it
      if (project) {
        const activityJQL = `"type" = Activity AND "Project Name[Short text]" ~ "${project}" AND Project = CWO ORDER BY summary ASC`;
        const activityIssues = await fetchIssuesByJQL(activityJQL);
        const activityOptions = activityIssues.map(issue => ({
          label: `${issue.fields.customfield_10970} | ${issue.fields.summary}`,
          value: issue.key,
        }));
        console.log(activityOptions)
        setSelectActivityOptions(activityOptions);

        if (activity) {
          const matched = activityOptions.find(opt => opt.value == activityKey);
          if (matched) {
            setSelectedActivity(matched);
          }
        }
      }
    };

    initialize();
  }, [context]);

  // On submit
  // try {
  //   const valueToSave = `${selectedProject?.value || ''}##${selectedActivity?.label || ''}`;
  //   await view.submit(valueToSave);
  // } catch (e) {
  //   console.error('Submit error:', e);
  // }
  const onSubmit = async () => {
    try {
      console.log('--- Submit Triggered ---');
      console.log('Render Context:', renderContext);
      console.log('Selected Project:', selectedProject);
      console.log('Selected Activity:', selectedActivity);

      if (renderContext !== 'issue-create' && !selectedActivity) {
        console.log('Condition met: renderContext is "issue-view" and Activity is NOT selected');
        console.log('Submitting NULL value...');
        await view.submit(null);
        return;
      }

      const valueToSave = `${selectedProject ?.value || ''}##${selectedActivity ?.label || ''}##${selectedActivity ?.value || ''}`;
      console.log('Condition met: Submitting composed value...');
      console.log('Composed Value:', valueToSave);
      await view.submit(valueToSave);
    } catch (e) {
      console.error('Submit error:', e);
    }
  };



  // Handle project selection
  const handleProjectChange = useCallback(async (option) => {
    setSelectedProject(option);
    setSelectedActivity(null);
    setSelectActivityOptions([]);

    const activityJQL = `"type" = Activity AND "Project Name[Short text]" ~ "${option.value}" AND Project = CWO ORDER BY summary ASC`;
    const activityIssues = await fetchIssuesByJQL(activityJQL);
    const activityOptions = activityIssues.map(issue => ({
      label:  `${issue.fields.customfield_10970} | ${issue.fields.summary}`,
      value: issue.key,
    }));
    setSelectActivityOptions(activityOptions);
  }, []);

  // Handle activity selection
  const handleActivityChange = useCallback((option) => {
    setSelectedActivity(option);
  }, []);

  return (
    <CustomFieldEdit onSubmit={onSubmit} hideActionButtons>
      <Select
        placeholder="Select Project ..."
        options={selectOptions}
        onChange={handleProjectChange}
        value={selectedProject}
        isLoading={selectOptions.length === 0}
      />
      <HelperMessage>Select a project to view activities</HelperMessage>

      <Select
        placeholder="Select Activity ..."
        options={selectActivityOptions}
        onChange={handleActivityChange}
        value={selectedActivity}
        isDisabled={!selectedProject}
        isLoading={selectedProject && selectActivityOptions.length === 0}
      />
    </CustomFieldEdit>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Edit />
  </React.StrictMode>
);
