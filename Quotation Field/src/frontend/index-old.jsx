import React, { useState, useEffect } from "react";
import ForgeReconciler, { Text } from "@forge/react";
import { view } from "@forge/bridge";

const View = () => {
  const [fieldValue, setFieldValue] = useState(null);

  useEffect(() => {
    view.getContext().then((context) => {
      setFieldValue(context.extension.fieldValue);
    });
  }, []);

  return (
    <>
      <Text>{`${fieldValue || "None"}`}</Text>
    </>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <View />
  </React.StrictMode>
);
