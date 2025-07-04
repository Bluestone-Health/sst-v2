import { patch, append, extract, install } from "create-sst";

export default [
  extract(),
  install({
    packages: ["sst@^2", "aws-cdk-lib@2.201.0", "constructs@10.3.0"],
    dev: true,
  }),
  patch({
    file: "package.json",
    operations: [
      { op: "add", path: "/scripts/dev", value: "sst bind next dev" },
    ],
  }),
  append({
    file: ".gitignore",
    string: ["", "", "# sst", ".sst", "", "# open-next", ".open-next"].join(
      "\n"
    ),
  }),
];
