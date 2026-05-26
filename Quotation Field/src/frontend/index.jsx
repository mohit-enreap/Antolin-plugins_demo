import React, { useState, useEffect } from "react";
import ForgeReconciler, { Text, Inline, Tag, Stack } from "@forge/react";
import { view } from "@forge/bridge";

const View = () => {
  const [fieldValue, setFieldValue] = useState(null);

  useEffect(() => {
    view.getContext().then((context) => {
      setFieldValue(context.extension.fieldValue);
    });
  }, []);

  if (!fieldValue) {
    return <Text>None</Text>;
  }

  // Splitting the stored string "Summary (Key) - Version"
  const parts = fieldValue.split(" ## ");
  const issueInfo = parts[0];
  // const keyInfo = parts[1];
  const versionInfo = parts[2];

  return (
    <Inline alignBlock="center" space="space.100">
      <Text>{issueInfo}</Text>
      {versionInfo && <Tag text={versionInfo} color="blue" />}
    </Inline>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <View />
  </React.StrictMode>,
);
