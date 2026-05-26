// src/App.js

import React, { useState, useEffect } from "react";
import Button from "@atlaskit/button";
import Select from "@atlaskit/select";
import Checkbox from "@atlaskit/checkbox";
import TextField from "@atlaskit/textfield";
import styled from "styled-components";
import { view, invoke } from "@forge/bridge"; // Forge API for modal interaction
// import { useProductContext } from '@forge/react';
import pako from "pako";

// Styled Components for better spacing and styling
const Container = styled.div`
  padding: 24px;
  max-height: 71vh;
  overflow-y: auto;
`;

const SectionHeader = styled.h3`
  margin: 24px 0 12px 0;
`;

const GroupHeader = styled.h4`
  margin: 16px 0 8px 0;
`;

const TotalHours = styled.div`
  font-weight: bold;
`;

const FooterHint = styled.div`
  // margin-top: 16px;
  color: #666;
`;

const StyledTable = styled.table`
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 24px;

  th,
  td {
    border: 1px solid #dfe1e6;
    padding: 8px;
    text-align: left;
    vertical-align: top;
  }

  th {
    background-color: #f4f5f7;
  }

  .group-header-row th,
  .group-header-row td {
    background-color: #ebecf0;
    font-weight: bold;
    text-align: left;
  }

  input[type="number"] {
    width: 100%;
    box-sizing: border-box;
    padding: 4px;
  }
`;
const StickyContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 16px 0px;
  background-color: white; /* Ensures it has a background when sticky */
  position: sticky;
  top: -24px; /* Sticks the container to the top of the viewport */
  z-index: 10; /* Ensures it stays above other content */
  border-bottom: 1px solid #dfe1e6; /* Optional: Adds a subtle border for visual separation */
`;

// Define a styled component for each field container
const FieldContainer = styled.div`
  flex: 1; /* Ensure fields take up equal space */
`;

const App = () => {
  // console.log(view.getContext())
  // console.log(issue.issueKey)

  const [phaseName, setPhaseName] = useState({
    label: "Proto",
    value: "Proto",
  });
  const [issueKey, setIssueKey] = useState("");
  const [extraWork, setExtraWork] = useState(null);
  const [newActivity, setNewActivity] = useState({
    key: "",
    standardLoop: 0,
    extraWorkLoop: 0,
    reWorkLoop: 0,
    standard: null,
    checked: true,
  }); //This is for the "Add new activity manually" feature.

  const [created, setCreated] = useState(false); // checked phase already created or not
  const [milestones, setMilestones] = useState({});
  console.log("milestone " + milestones); //holds ALL milestone data

  const [activities, setActivities] = useState({}); //This holds ALL activity data.

  const [totalHours, setTotalHours] = useState(0);
  const [standardHours, setStandardHours] = useState(0);
  const [extraHours, setExtraHours] = useState(0);
  const [reworkHours, setReworkHours] = useState(0);
  //All four of these are calculated values — they are never set manually by the user. They get recalculated automatically in useEffect whenever activities changes.

  const [threeDModifications, setThreeDModifications] = useState(0);
  const [twoDModifications, setTwoDModifications] = useState(0);
  const [dataManagement, setDataManagement] = useState(0);
  //They measure how many hours came from 3D work vs 2D work vs data management.

  const [product, setProduct] = useState("");

  const [iterations, setIterations] = useState(0);

  // useEffect(async () => {
  //   const context = await view.getContext();
  //     const issue = context.extension.issue;
  //   const fetchMilestones = async () => {
  //     const data = await invoke("getConfigData", { issue,key: "Milestone" });
  //     setMilestones(data);
  //   };
  //   const fetchActivities = async () => {
  //     const data = await invoke("getConfigData", { issue,key: "Activity" });
  //     setActivities(data);
  //   };
  //   fetchMilestones();
  //   fetchActivities();
  // }, []);

  useEffect(() => {
    // Calculate total hours whenever activities change
    console.log(activities);

    // let sum = Object.values(activities).reduce(
    //   (acc, activity) => acc + (activity.checked && activity.standardLoop ? activity.total : 0),
    //   0
    // );

    let sum = Object.entries(activities).reduce(
      (acc, [key, activity]) =>
        acc +
        (!key.includes("ITERATIONS") &&
        activity.checked &&
        activity.standardLoop
          ? activity.total
          : 0),
      0,
    );

    const standard = Object.values(activities).reduce(
      (acc, activity) =>
        acc +
        (activity.checked ? activity.standardLoop * activity.standard : 0),
      0,
    ); // standard hours calculation is based on standardLoop value. If standardLoop is 0, it means the activity is not selected for standard hours, and thus contributes 0 to the total standard hours. If standardLoop is 1, it means the activity is selected for standard hours, and contributes its full standard hours to the total.

    const extra = Object.values(activities).reduce(
      (acc, activity) =>
        acc +
        (activity.checked ? activity.extraWorkLoop * activity.standard : 0),
      0,
    );

    const rework = Object.values(activities).reduce(
      (acc, activity) =>
        acc + (activity.checked ? activity.reWorkLoop * activity.standard : 0),
      0,
    );

    const _dataManagement = Object.entries(activities)
      .filter(
        ([key, value]) =>
          (key.includes("Customer input data management") ||
            key.includes("Data management") ||
            key.includes("Upload & Download customer data")) &&
          value.checked &&
          value.standardLoop,
      )
      .reduce((sum, [key, value]) => sum + (value.standard || 0), 0);

    const _2DModification = Object.entries(activities)
      .filter(
        ([key, value]) =>
          (key.startsWith("2D Drawing") || key.startsWith("2D DELIVERABLES")) &&
          value.checked &&
          value.standardLoop,
      )
      .reduce((sum, [key, value]) => sum + (value.standard || 0), 0);
    try {
      const _Iteration =
        (
          (Object.entries(activities)
            .filter(
              ([key, value]) =>
                !(
                  key.includes("ITERATIONS") || key.includes("TCL ACTIVITIES")
                ) && // Exclude both
                value.checked &&
                value.standardLoop,
            )
            .reduce((sum, [key, value]) => sum + (value.standard || 0), 0) *
            (activities["ITERATIONS|ITERATIONS"]?.percentage || 0)) /
          100
        ).toFixed(2) || 0;
      console.log("Iteration", _Iteration);
      setIterations(parseFloat(_Iteration));

      if (
        activities["ITERATIONS|ITERATIONS"].checked &&
        activities["ITERATIONS|ITERATIONS"].standardLoop > 0
      ) {
        sum = parseFloat(sum) + parseFloat(_Iteration);
      }
      // console.log("HELLO sum",sum)
    } catch (e) {
      console.error(e);
    }

    setTotalHours(parseFloat(sum));
    setStandardHours(standard);
    setExtraHours(extra);
    setReworkHours(rework);
    setDataManagement(_dataManagement);
    setTwoDModifications(_2DModification);
    setThreeDModifications(sum - _2DModification - _dataManagement);
  }, [activities]);

  const phaseOptions = [
    { label: "Proto", value: "Proto" },
    { label: "Serie", value: "Serie" },
    { label: "Industrialization", value: "Industrialization" },
  ];
  const extraWorkOptions = [
    { label: "Formal", value: "Formal" },
    { label: "Informal", value: "Informal" },
  ];

  //   useEffect(() => {

  // const base64String = localStorage.getItem('appDataZipped');
  // if (base64String) {
  //   // Convert Base64 to Uint8Array
  //   const uint8Arr = base64ToUint8Array(base64String);

  //   // Decompress
  //   const decompressedString = pako.inflate(uint8Arr, { to: 'string' });
  //   const parsedData = JSON.parse(decompressedString);
  //       console.log(parsedData)
  //       // Set states from the decompressed data
  //       setPhaseName(parsedData.phaseName);
  //       setExtraWork(parsedData.extraWork);
  //       setMilestones(parsedData.milestones);
  //       setActivities(parsedData.activities);
  //       setTotalHours(parsedData.totalHours);
  //     }
  //   }, []);

  // Fetch issue context using view.getContext()
  useEffect(async () => {
    await loadAllValues("Proto");
  }, []);

  const loadAllValues = async (phase) => {
    const context = await view.getContext();
    const issue = context.extension.issue; // context.issue may contain { key: 'ABC-123', ... }
    console.log(issue);
    const fetchMilestones = async () => {
      const data = await invoke("getConfigData", {
        issue,
        phase,
        key: "Milestone",
      });
      setMilestones(data);
    };
    const fetchActivities = async () => {
      const data = await invoke("getConfigData", {
        issue,
        phase,
        key: "Activity",
      });
      setActivities(data.activity);
      console.log("producttttt", data.product);
      setProduct(data.product);
    };
    await fetchMilestones();
    await fetchActivities();
    setCreated(false);
    if (issue && issue.key) {
      setIssueKey(issue.key);
      // Once we have issueKey, fetch data from storage
      const base64String = await invoke("getData", {
        issueKey: issue.key,
        phase,
      });
      if (base64String) {
        const uint8Arr = base64ToUint8Array(base64String);
        const decompressedString = pako.inflate(uint8Arr, { to: "string" });
        const parsedData = JSON.parse(decompressedString);

        setPhaseName(parsedData.phaseName);
        // setExtraWork(parsedData.extraWork);
        setMilestones(parsedData.milestones);
        setActivities(parsedData.activities);
        setTotalHours(parsedData.totalHours);
        setCreated(true);
      }
    }
  };

  function uint8ArrayToBase64(uint8Arr) {
    let CHUNK_SIZE = 0x8000; // To avoid "maximum call stack size exceeded" for large data
    let chunks = [];
    for (let i = 0; i < uint8Arr.length; i += CHUNK_SIZE) {
      chunks.push(
        String.fromCharCode.apply(null, uint8Arr.subarray(i, i + CHUNK_SIZE)),
      );
    }
    const binaryString = chunks.join("");
    return btoa(binaryString);
  }
  function base64ToUint8Array(base64) {
    const binaryString = atob(base64);
    const length = binaryString.length;
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  const handleMilestoneChange = (key) => {
    setMilestones((prev) => ({
      ...prev,
      [key]: { ...prev[key], checked: !prev[key].checked },
    }));
  }; //Called when: User clicks a milestone checkbox.

  const handleMilestoneLoopChange = (key, value) => {
    const loops = parseInt(value, 10);
    if (loops >= 1 && loops <= 10) {
      setMilestones((prev) => ({
        ...prev,
        [key]: { ...prev[key], loops: loops },
      }));
    }
  };

  const handleActivityChange = (key) => {
    setActivities((prev) => ({
      ...prev,
      [key]: { ...prev[key], checked: !prev[key].checked },
    }));
  };
  const handlePhaseChange = async (phase) => {
    await loadAllValues(phase);
  };
  // const handleActivityLoopChange =async (key,loop, value) => {
  //   console.log(loop,value)
  //   const loops = parseInt(value, 10);
  //   if (loops >= 1 && loops <= 5) {
  //     setActivities((prev) => ({
  //       ...prev,
  //       [key]: { ...prev[key], [loop]: loops, total: prev[key].standard * ( prev[key].standardLoop +  prev[key].extraWorkLoop + prev[key].reWorkLoop) },
  //     }));
  //     // console.log(activities[key])
  //   }
  // };

  const handleActivityLoopChange = (key, loop, value) => {
    const loops = parseInt(value, 10);
    if (loops >= 0 && loops <= 5) {
      setActivities((prev) => {
        // Create a copy of the current activity and update the loop value
        const updatedActivity = {
          ...prev[key],
          [loop]: loops,
        };

        console.log("updatedActivity", updatedActivity);
        // // Calculate the new total using the updated values
        // updatedActivity.total =
        //   updatedActivity.standard *
        //   (updatedActivity.standardLoop + updatedActivity.extraWorkLoop + updatedActivity.reWorkLoop);
        // Calculate the new total using the updated values
        console.log("test", key);
        updatedActivity.total =
          updatedActivity.standard * updatedActivity.standardLoop;

        return {
          ...prev,
          [key]: updatedActivity,
        };
      });
    }
  };

  const handleCreate = async () => {
    // Prepare data to submit
    // const selectedMilestones = Object.entries(milestones)
    //   .filter(([_, value]) => value.checked)
    //   .map(([key, value]) => ({
    //     name: key.split('|')[1],
    //     loops: value.loops,
    //   }));

    // const selectedActivities = Object.entries(activities)
    //   .filter(([_, value]) => value.checked)
    //   .map(([key, value]) => ({
    //     name: key.split('|')[1],
    //     loops: value.loops,
    //     total: value.total,
    //   }));
    let updatedActivities = product.includes("- CAE")
      ? (activities["ITERATIONS|ITERATIONS"].standard = parseFloat(iterations))
      : activities;
    product.includes("- CAE")
      ? (activities["ITERATIONS|ITERATIONS"].total = parseFloat(iterations))
      : activities;
    product.includes("- CAE")
      ? (activities["ITERATIONS|ITERATIONS"].DE = parseFloat(iterations))
      : activities;
    const data = {
      phaseName: phaseName,
      issueKey,
      extraWork,
      // milestones: selectedMilestones,
      // activities: selectedActivities,
      milestones: milestones,
      activities: activities,
      totalHours,
      _3DModification: threeDModifications,
      _2DModification: twoDModifications,
      dataManagement,
    };
    console.log(JSON.stringify(data));

    // Submit the data to the server
    // fetch('http://xyz.com/rest/scriptrunner/latest/custom/createCadPhaseResult', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(data),
    // })
    //   .then((response) => {
    //     if (response.ok) {
    //       // Handle success (e.g., show success message)
    //       alert('Phase created successfully!');
    //     } else {
    //       // Handle error
    //       alert('Failed to create phase.');
    //     }
    //   })
    //   .catch((error) => {
    //     console.error('Error:', error);
    //     alert('An error occurred while creating the phase.');
    //   });
    // Save data to localStorage
    const jsonString = JSON.stringify(data);
    const compressedData = pako.deflate(jsonString);
    const base64String = uint8ArrayToBase64(compressedData);

    // Save data in Forge storage keyed by the issueKey
    invoke("setData", { issueKey, base64Data: base64String });
    handleClose();
  };

  const handleClose = () => {
    view.close(); // Forge API to close the modal/dialog
  };

  const handleAddNewActivity = () => {
    if (!newActivity.key.trim()) {
      alert("Activity name cannot be empty");
      return;
    }
    console.log(newActivity.key);
    const newKey = `Other Activity|${newActivity.key}`;
    if (activities[newKey]) {
      alert("Activity name already exists");
      return;
    }
    console.log(newKey, newActivity);
    // setActivities((prev) => ({
    //   ...prev,
    //   [newKey]: {
    //     ...newActivity,
    //     total:
    //       newActivity.standard *
    //       (newActivity.standardLoop + newActivity.extraWorkLoop + newActivity.reWorkLoop),
    //   },
    // }));
    setActivities((prev) => ({
      ...prev,
      [newKey]: {
        ...newActivity,
        total: newActivity.standard * newActivity.standardLoop,
      },
    }));
    setNewActivity({
      key: "",
      standardLoop: 0,
      extraWorkLoop: 0,
      reWorkLoop: 0,
      standard: null,
      checked: true,
    });
  };

  const renderMilestoneTable = (
    milestones,
    handleMilestoneChange,
    handleMilestoneLoopChange,
  ) => {
    const groupMilestones = (milestones) => {
      return Object.entries(milestones)
        .sort(([keyA, valueA], [keyB, valueB]) => {
          const orderA = parseInt(valueA.order, 10);
          const orderB = parseInt(valueB.order, 10);
          return orderA - orderB;
        })
        .reduce((groups, [key, value]) => {
          const [group, label] = key.split("|");
          if (!groups[group]) {
            groups[group] = [];
          }
          groups[group].push({ key, label, ...value });
          return groups;
        }, {});
    };

    const groupedMilestones = groupMilestones(milestones);
    console.log(JSON.stringify(groupedMilestones));

    return (
      <StyledTable>
        <thead>
          <tr>
            <th>Milestone</th>
            <th>Number of Loops</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(groupedMilestones).map(([group, items]) => (
            <React.Fragment key={group}>
              <tr className="group-header-row">
                <td colSpan="2">{group}</td>
              </tr>
              {items.map(({ key, label, checked, loops }) => (
                <tr key={key}>
                  <td>
                    <Checkbox
                      isChecked={checked}
                      onChange={() => handleMilestoneChange(key)}
                      label={label}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={loops}
                      onChange={(e) =>
                        handleMilestoneLoopChange(key, e.target.value)
                      }
                      disabled={!checked}
                    />
                  </td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </StyledTable>
    );
  };

  const renderActivityTable = (
    data,
    handleActivityChange,
    handleActivityLoopChange,
  ) => {
    const groupData = (data) => {
      return Object.entries(data)
        .sort(([keyA, valueA], [keyB, valueB]) => {
          const orderA = parseInt(valueA.order, 10);
          const orderB = parseInt(valueB.order, 10);
          return orderA - orderB;
        })
        .reduce((groups, [key, value]) => {
          const [group, label] = key.split("|");
          if (group != "Other Activity" && !groups[group]) {
            groups[group] = [];
          }
          if (group != "Other Activity")
            groups[group].push({ key, label, ...value });
          return groups;
        }, {});
    };

    const groupedData = groupData(data);

    return (
      <StyledTable>
        <thead>
          <tr>
            <th style={{ width: "50%" }}>Activity</th>
            <th style={{ width: "10%" }}>Standard Loop</th>
            <th style={{ width: "10%" }}>Standard</th>
            {/* <th style={{ width: "10%" }}>Total Hours</th> */}
            <th style={{ width: "10%" }}>Extra Work</th>
            <th style={{ width: "10%" }}>Rework</th>
            <>
              {product.includes("- CAE") ? (
                <th style={{ width: "10%" }}>CAE - Iteration</th>
              ) : null}
            </>
          </tr>
        </thead>
        <tbody>
          {Object.entries(groupedData).map(([group, items]) => (
            <React.Fragment key={group}>
              <tr className="group-header-row">
                <td colSpan="6">{group}</td>
              </tr>
              {items.map(
                ({
                  key,
                  label,
                  checked,
                  standardLoop,
                  extraWorkLoop,
                  reWorkLoop,
                  caeIterationLoop,
                  standard,
                  total,
                }) => (
                  <tr key={key}>
                    <td>
                      <Checkbox
                        isChecked={checked}
                        onChange={() => handleActivityChange(key)}
                        label={label}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max="1"
                        value={standardLoop}
                        onChange={(e) =>
                          handleActivityLoopChange(
                            key,
                            "standardLoop",
                            e.target.value,
                          )
                        }
                        disabled={!checked || (checked && created)}
                      />
                    </td>
                    {console.log("standard", key, standard)}

                    <td>
                      {product.includes("- CAE") && key.includes("ITERATIONS")
                        ? iterations
                        : parseFloat((standard ?? 0).toFixed(2))}
                    </td>
                    {/* <td>{total}</td> */}

                    <td>
                      <input
                        type="number"
                        min="-1"
                        max="5"
                        value={extraWorkLoop}
                        onChange={(e) =>
                          handleActivityLoopChange(
                            key,
                            "extraWorkLoop",
                            e.target.value,
                          )
                        }
                        disabled={!checked || (checked && !created)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="-1"
                        max="5"
                        value={reWorkLoop}
                        onChange={(e) =>
                          handleActivityLoopChange(
                            key,
                            "reWorkLoop",
                            e.target.value,
                          )
                        }
                        disabled={!checked || (checked && !created)}
                      />
                    </td>
                    <>
                      {console.log("CAEIteration - > ", caeIterationLoop)}
                      {product.includes("- CAE") ? (
                        <td>
                          <input
                            type="number"
                            min="0"
                            max="5"
                            value={caeIterationLoop}
                            onChange={(e) =>
                              handleActivityLoopChange(
                                key,
                                "caeIterationLoop",
                                e.target.value,
                              )
                            }
                            disabled={!checked || (checked && !created)}
                          />
                        </td>
                      ) : null}
                    </>
                  </tr>
                ),
              )}
            </React.Fragment>
          ))}
        </tbody>
      </StyledTable>
    );
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "24px",
          position: "relative", // Set the parent to relative for child positioning
        }}
      >
        <h2>Create Phase</h2>
        <div
          style={{
            position: "absolute", // Absolute positioning for floating
            right: "24px", // Align to the right
            // top: '24px', // Align towards the top
            // backgroundColor: 'white', // Optional: Background for visibility
            // padding: '12px', // Add padding for spacing
            // boxShadow: '0 2px 6px rgba(0, 0, 0, 0.2)', // Optional: Shadow for better visibility
            zIndex: 100, // Ensure it's above other elements
          }}
        >
          <table>
            <tbody>
              <tr>
                <td>
                  <TotalHours>Total Hours:</TotalHours>
                </td>
                <td>
                  <TotalHours>
                    {parseFloat(totalHours.toFixed(2))} hrs
                  </TotalHours>
                  {console.log(
                    "testing",
                    parseFloat(Number(totalHours + iterations).toFixed(2)),
                    iterations,
                  )}
                </td>
              </tr>
              {/* <tr>
                <td>
                  <TotalHours style={{ "font-weight": "500" }}>Standard Hours:</TotalHours>
                </td>
                <td>
                  <TotalHours style={{ "font-weight": "500" }}>{standardHours} hrs</TotalHours>
                </td>
              </tr>
              <tr>
                <td>
                  <TotalHours style={{ "font-weight": "500" }}>Extra Hours:</TotalHours>
                </td>
                <td>
                  <TotalHours style={{ "font-weight": "500" }}>{extraHours} hrs</TotalHours>
                </td>
              </tr>
              <tr>
                <td>
                  <TotalHours style={{ "font-weight": "500" }}>Re-Work Hours:</TotalHours>
                </td>
                <td>
                  <TotalHours style={{ "font-weight": "500" }}>{reworkHours} hrs</TotalHours>
                </td>
              </tr> */}
              {console.log(product)}
              {/* {phaseName.value == "Industrialization" || product.includes("- CAE") ? <></> : <><tr>
                <td>
                  <TotalHours style={{ "font-weight": "500" }}>3D Modifications:</TotalHours>
                </td>
                <td>
                  <TotalHours style={{ "font-weight": "500" }}>{threeDModifications} hrs</TotalHours>
                </td>
              </tr>
                <tr>
                  <td>
                    <TotalHours style={{ "font-weight": "500" }}>2D Modifications:</TotalHours>
                  </td>
                  <td>
                    <TotalHours style={{ "font-weight": "500" }}>{parseFloat(twoDModifications.toFixed(2))} hrs</TotalHours>
                  </td>
                </tr>
                <tr>
                  <td>
                    <TotalHours style={{ "font-weight": "500" }}>Data Management:</TotalHours>
                  </td>
                  <td>
                    <TotalHours style={{ "font-weight": "500" }}>{dataManagement} hrs</TotalHours>
                  </td>
                </tr></>
              } */}
            </tbody>
          </table>
        </div>
      </div>
      <Container>
        {/* <Button appearance="subtle" onClick={() => {}} style={{ float: 'right' }}>
        Close
      </Button> */}
        {/* Sticky Fields */}
        <StickyContainer>
          <FieldContainer>
            <label>
              <strong>Phase Name</strong>
            </label>
            <Select
              options={phaseOptions}
              placeholder="Select Phase"
              onChange={(selected) => {
                setPhaseName(selected);
                loadAllValues(selected.value);
              }}
              value={phaseName}
              de
              isRequired
            />
          </FieldContainer>
          <FieldContainer>
            {/* <label>
              <strong>Extra Work</strong>
            </label>
            <Select
              options={extraWorkOptions}
              placeholder="Select Extra Work"
              onChange={(selected) => setExtraWork(selected)}
              value={extraWork}
            /> */}
          </FieldContainer>
        </StickyContainer>

        {/* Parent Issue */}
        <div style={{ marginBottom: "16px", display: "none" }}>
          <label>
            <strong>Parent Issue</strong>
          </label>
          <TextField value={issueKey} readOnly isDisabled />
        </div>

        {/* Extra Work
        <div style={{ marginBottom: '16px' }}>
          <Checkbox
            isChecked={extraWork}
            onChange={(e) => setExtraWork(e.target.checked)}
            label="Extra Work"
          />
        </div> */}

        {/* Milestones Table */}
        {/* {phaseName.value != "Industrialization" &&
        !product.includes("- CAE") */}

        {phaseName.value != "Industrialization" ? (
          <>
            <SectionHeader>Milestones to Generate</SectionHeader>
            {renderMilestoneTable(
              milestones,
              handleMilestoneChange,
              handleMilestoneLoopChange,
            )}
          </>
        ) : (
          <></>
        )}
        {/* Activities Table */}
        <SectionHeader>Activities to Generate</SectionHeader>

        {renderActivityTable(
          activities,
          handleActivityChange,
          handleActivityLoopChange,
        )}

        <SectionHeader>Other Activities</SectionHeader>
        <tr>
          <td>
            <TextField
              name="new-activity"
              placeholder="New Activity"
              value={newActivity.key.split("|").slice(-1)[0]}
              onChange={(e) =>
                setNewActivity({ ...newActivity, key: e.target.value })
              }
            />
          </td>

          <td>
            <TextField
              name="standard-hours"
              placeholder="Standard Hours"
              type="number"
              value={newActivity.standard}
              onChange={(e) =>
                setNewActivity({
                  ...newActivity,
                  standard: parseFloat(e.target.value) || null,
                })
              }
              isDisabled={created}
            />
          </td>
          <td>
            <Button onClick={handleAddNewActivity}>Add Activity</Button>
          </td>
        </tr>
        <StyledTable>
          <thead>
            <tr>
              <th style={{ width: "50%" }}>Activity</th>
              <th style={{ width: "10%" }}>Standard Loop</th>
              <th style={{ width: "10%" }}>Standard Hours</th>
              {/* <th style={{ width: "10%" }}>Total Hours</th> */}
              <th style={{ width: "10%" }}>Extra Work</th>
              <th style={{ width: "10%" }}>Rework</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(activities)
              .filter((key) => key.startsWith("Other"))
              .map((key) => (
                <tr key={key}>
                  <td>
                    <Checkbox
                      isChecked={activities[key].checked}
                      onChange={() => handleActivityChange(key)}
                      label={key.split("|")[1]}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max="1"
                      value={activities[key].standardLoop}
                      onChange={(e) =>
                        handleActivityLoopChange(
                          key,
                          "standardLoop",
                          e.target.value,
                        )
                      }
                      disabled={
                        !activities[key].checked ||
                        (activities[key].checked && created)
                      }
                    />
                  </td>
                  <td>{activities[key].standard}</td>
                  {/* <td>{activities[key].total}</td> */}
                  <td>
                    <input
                      type="number"
                      min="0"
                      max="5"
                      value={activities[key].extraWorkLoop}
                      onChange={(e) =>
                        handleActivityLoopChange(
                          key,
                          "extraWorkLoop",
                          e.target.value,
                        )
                      }
                      disabled={
                        !activities[key].checked ||
                        (activities[key].checked && !created)
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min="0"
                      max="5"
                      value={activities[key].reWorkLoop}
                      onChange={(e) =>
                        handleActivityLoopChange(
                          key,
                          "reWorkLoop",
                          e.target.value,
                        )
                      }
                      disabled={
                        !activities[key].checked ||
                        (activities[key].checked && !created)
                      }
                    />
                  </td>
                </tr>
              ))}
          </tbody>
        </StyledTable>
      </Container>
      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          //marginTop: '24px',
          padding: "24px",
          overflowY: "auto",
          marginRight: "24px",
        }}
      >
        <FooterHint>
          Click on create to create all activities for the phase.
        </FooterHint>

        <div>
          <a
            appearance="subtle"
            onClick={handleClose}
            style={{ padding: "26px", cursor: "pointer" }}
          >
            Cancel
          </a>
          <Button appearance="primary" onClick={handleCreate}>
            Create
          </Button>
        </div>
      </div>
    </>
  );
};

export default App;
