import React, { useState, useEffect, useCallback } from 'react';//10806
import ForgeReconciler, { Select, HelperMessage, useProductContext } from '@forge/react';
import { CustomFieldEdit } from '@forge/react/jira';
import { view, invoke } from '@forge/bridge';

const Edit = () => {
  const [value, setValue] = useState('');
  const [renderContext, setRenderContext] = useState(null)
  const [activityValue, setActivityValue] = useState('');

  const [activitySelected, setActivitySelected] = useState('')
  const [selectOptions, setSelectOptions] = useState([]);
  const [selectActivityOptions, setSelectActivityOptions] = useState([]);

  const context = useProductContext(); // Retrieve the issue context

  // Function to fetch issues using JQL
  const fetchIssuesByJQL = async (jql) => {
    try {
      const response = await invoke('getIssuesByJQL', { jql });
      return response.issues || [];
    } catch (error) {
      console.error('Error fetching issues:', error);
      return [];
    }
  };

  // Fetch issues and set options
  useEffect(() => {
    const initializeSelectOptions = async () => {
      view.getContext().then((context) => { 
        setRenderContext(context.extension.renderContext)
        setValue(context.extension.fieldValue.toString())
        if(!context.extension.fieldValue) setValue('')
       })
      // console.log(value)
      const issueKey = "Project";
      const jql = `\"type\" = ${issueKey} ORDER BY key ASC`; // Modify as needed
      const issues = await fetchIssuesByJQL(jql);

      const options = issues.map(issue => ({
        label: `${issue.fields.summary}`,
        value: `${issue.fields.summary}`,
      }));

      setSelectOptions(options);

    };

    initializeSelectOptions();
  }, [context]);

  const onSubmit = async () => {
    try {
      console.log("VAlue -> ", value)
      console.log("Activity -> ", activityValue)
      await view.submit(value + '##' + activityValue);

    } catch (e) {
      console.error(e);
    }
  }

  const handleOnChange = useCallback(async (selectedOption) => {
    console.log(value)
    setValue(selectedOption.value);
    console.log(selectedOption.value)
    const issueKey = "Project";
    const jql = `\"type\" = Activity AND \"Project Name[Short text]\" ~ \"${selectedOption.value}\" AND Project = CWO ORDER BY summary ASC`; // Modify as needed
    console.log(jql)
    const issues = await fetchIssuesByJQL(jql);

    const options = issues.map(issue => ({
      label: `${issue.fields.summary}`,
      value: `${issue.key}`,
    }));

    setSelectActivityOptions(options);
    const isOptionExist = options.find(x => activitySelected === x.value)
    if (!isOptionExist) setActivitySelected('')

  }, []);
  const handleOnActivityChange = useCallback(async (selectedOption) => {
    // console.log(selectedOption.value)
    if (selectedOption) setActivityValue(selectedOption.label)
    setActivitySelected(selectedOption)
  }, [value, activityValue])

  return (
    <CustomFieldEdit onSubmit={onSubmit} hideActionButtons>
      <Select
        placeholder="Select Project ..."
        options={selectOptions}
        onChange={handleOnChange}
        defaultValue={value?{label:value.split("##")[0],value:value.split("##")[0]}:null}
        // isClearable	={true}
        isLoading={selectOptions.length === 0} // Show loading state if options are empty

      />
      <HelperMessage></HelperMessage>

      <Select
        placeholder="Select Activity ..."
        options={selectActivityOptions}
        onChange={handleOnActivityChange}
        value={activitySelected}
        defaultValue={value!=='' && value.split("##").length==2?{label:value.split("##")[1],value:value.split("##")[1]}:null}

      // isClearable	={true}
      // isLoading={selectActivityOptions.length === 0} // Show loading state if options are empty
      />

    </CustomFieldEdit>

  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Edit />
  </React.StrictMode>
);
