import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as netmask from "netmask";

let config = new pulumi.Config();
const vpc = new aws.ec2.Vpc(config.require('vpc_name'), {

    cidrBlock: config.require('vpc_cidr') + "/" + config.require('vpc_mask'),
    enableDnsHostnames: true,
    tags: { Name: config.require('vpc_name') },

});

const availabilityZones = pulumi.output(aws.getAvailabilityZones());

const internetgateway = new aws.ec2.InternetGateway(config.require('igw_name'), {
    vpcId: vpc.id,
    tags: { Name: config.require('igw_name') },
});

const publicSubnets: aws.ec2.Subnet[] = [];
const privateSubnets: aws.ec2.Subnet[] = [];

const publicRouteTable = new aws.ec2.RouteTable(config.require('public_route_name'), {
    vpcId: vpc.id,
    tags: { Name: config.require('public_route_name') }
});

const privateRouteTable = new aws.ec2.RouteTable(config.require('private_route_name'), {
    vpcId: vpc.id,
    tags: { Name: config.require('private_route_name') }
});

const availabilityZonesResult = availabilityZones.apply(availabilityZones => availabilityZones.names.slice(0, 3));
var cidr_block = new netmask.Netmask(config.require('vpc_cidr') + "/" + config.require('subnet_mask'))

availabilityZonesResult.apply(availabilityZones => {
    availabilityZones.forEach((az, i) => {

        // Create a public subnet with a name tag
        const publicSubnet = new aws.ec2.Subnet(`public-subnet-${i}`, {
            cidrBlock: cidr_block.toString(),
            mapPublicIpOnLaunch: true,
            vpcId: vpc.id,
            availabilityZone: az,
            tags: {
                Name: `publicSubnet-${i}`,
            },
        });
        cidr_block = cidr_block.next()
        publicSubnets.push(publicSubnet);

        new aws.ec2.RouteTableAssociation(`publicRouteTableAssociation-${i}`, {
            subnetId: publicSubnet.id,
            routeTableId: publicRouteTable.id,
        });

        const privateSubnet = new aws.ec2.Subnet(`private-subnet-${i}`, {
            cidrBlock: cidr_block.toString(),
            vpcId: vpc.id,
            availabilityZone: az,
            tags: {
                Name: `privateSubnet-${i}`, // Set the name tag
            },
        });
        cidr_block = cidr_block.next()
        privateSubnets.push(privateSubnet);

        new aws.ec2.RouteTableAssociation(`privateRouteTableAssociation-${i}`, {
            subnetId: privateSubnet.id,
            routeTableId: privateRouteTable.id,
        });
        if (i == 1) {
            const sg = new aws.ec2.SecurityGroup(config.require('sg'), {
                vpcId: vpc.id,
                ingress: [
                    {
                        protocol: "tcp",
                        fromPort: 80,
                        toPort: 80,
                        cidrBlocks: [config.require('dest_cidr') + "/" + config.require('dest_mask')]
                    },
                    {
                        protocol: "tcp",
                        fromPort: 443,
                        toPort: 443,
                        cidrBlocks: [config.require('dest_cidr') + "/" + config.require('dest_mask')]
                    },
                    {
                        protocol: "tcp",
                        fromPort: 22,
                        toPort: 22,
                        cidrBlocks: [config.require('dest_cidr') + "/" + config.require('dest_mask')]
                    },
                    {
                        protocol: "tcp",
                        fromPort: 3000,
                        toPort: 3000,
                        cidrBlocks: [config.require('dest_cidr') + "/" + config.require('dest_mask')]
                    }
                ],
                egress: [{
                    fromPort: 5432,
                    toPort: 5432,
                    protocol: "tcp",
                    cidrBlocks: [config.require('dest_cidr') + "/" + config.require('dest_mask')],

                }],
            });
            const sg1 = new aws.ec2.SecurityGroup(config.require('sg1'), {
                vpcId: vpc.id,
                ingress: [
                    {
                        protocol: "tcp",
                        fromPort: 5432,
                        toPort: 5432,
                        // cidrBlocks: [config.require('dest_cidr') + "/" + config.require('dest_mask')],
                        securityGroups: [sg.id]
                    }]
            })


            const pgParameterGroup = new aws.rds.ParameterGroup("parameter-group", {
                family: "postgres15",
                description: "Parameter group for Postgres",
                parameters: [{
                    applyMethod: "pending-reboot",
                    name: "rds.force_ssl",
                    value: "0"
                }]
            })

            const Subnetgroup = new aws.rds.SubnetGroup("subnet-group", {
                subnetIds: [privateSubnets[0].id, privateSubnets[1].id],
            })

            const RDSInstance = new aws.rds.Instance("csye6225", {
                allocatedStorage: 20,
                engine: "postgres",
                engineVersion: "15.4", 
                instanceClass: "db.t3.micro",
                multiAz: false,
                parameterGroupName: pgParameterGroup.name,
                username: config.require('username'),
                password: config.require('password'),
                dbName: config.require('database'),
                dbSubnetGroupName: Subnetgroup.name,
                publiclyAccessible: false,
                skipFinalSnapshot: true, 
                vpcSecurityGroupIds: [sg1.id],
            });

            const ami_id = pulumi.output(aws.ec2.getAmi({
                executableUsers: ["self"],
                filters: [
                    {
                        name: "name",
                        values: ["csye6225-ami-*"],
                    },
                    {
                        name: "root-device-type",
                        values: ["ebs"],
                    },
                    {
                        name: "virtualization-type",
                        values: ["hvm"],
                    },
                ],
                mostRecent: true,
                nameRegex: "^csye6225-ami-\\d{3}",
                owners: [config.require('aws_account_id')],
            }))

            const ec2Instance = new aws.ec2.Instance(config.require('instance_name'), {
                ami: ami_id.id,
                instanceType: config.require('instance_type'),
                subnetId: publicSubnets[0].id,
                vpcSecurityGroupIds: [sg.id],
                keyName: config.require('key-name'),
                associatePublicIpAddress: true,
                disableApiTermination: false,
                rootBlockDevice: {
                    volumeSize: 25,
                    volumeType: "gp2",
                    deleteOnTermination: true,
                },
                userData: pulumi.interpolate`#!/bin/bash
                    echo 'DATABASE_USER=${RDSInstance.username}' >> /etc/environment
                    echo 'DATABASE_PASS=${RDSInstance.password}' >> /etc/environment
                    echo 'DATABASE=${RDSInstance.dbName}' >> /etc/environment
                    echo "DATABASE_HOST=${RDSInstance.address}" >> /etc/environment
                    echo 'DATABASE_PORT=${config.require('port')}' >> /etc/environment
                    echo 'DIALECT=${config.require('dialect')}' >> /etc/environment
                    echo 'DEFAULTUSERSPATH=${config.require('defaultuserspath')}' >> /etc/environment
                    echo 'NODE_PORT=${config.require('node')}' >> /etc/environment
                `,
            });
        }
    });

});
new aws.ec2.Route("publicRoute", {
    routeTableId: publicRouteTable.id,
    destinationCidrBlock: config.require('dest_cidr') + "/" + config.require('dest_mask'),
    gatewayId: internetgateway.id,
});

