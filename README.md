# IaC w/Pulumi

This repository contains Pulumi code that provisions an AWS Virtual Private Cloud (VPC) and deploys a PostgreSQL RDS instance within the VPC. The infrastructure includes public and private subnets, security groups, and an internet gateway for connectivity. It also launches an EC2 instance with user data for application deployment.

## Prerequisites

Before deploying this infrastructure, ensure you have the following prerequisites:

-Pulumi CLI

-AWS CLI with configured credentials

-Node.js for installing dependencies

-AWS account with the necessary permissions

## Getting Started

Clone this repository to your local machine.

```bash
git clone https://github.com/yourusername/iac-pulumi.git
cd iac-pulumi
```

Install the required Node.js packages.

```bash
npm install
```
Configure the deployment by modifying the Pulumi.dev.yaml file with your desired configuration. Update parameters such as VPC CIDR, subnet configurations, security groups, RDS settings, and more.

Deploy the infrastructure using Pulumi.

```bash
pulumi up
```

To Destroy the infrastructure using Pulumi.

```bash
pulumi destroy
```