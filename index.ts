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

        if (i == 0) {
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
                        fromPort: 433,
                        toPort: 433,
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
                ]
            });



            const ec2Instance = new aws.ec2.Instance(config.require('instance_name'), {
                ami: config.require('ami'),
                instanceType: config.require('instance_type'),
                subnetId: publicSubnet.id,
                vpcSecurityGroupIds: [sg.id], // Reference the security group
                // Enable EBS termination protection
                keyName: 'ass5',
                associatePublicIpAddress: true,
                disableApiTermination: false,
                rootBlockDevice: {
                    volumeSize: 25, 
                    volumeType: "gp2",
                },  // Replace '0' with the index of the desired subnet
            });
        }



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



    });

});


new aws.ec2.Route("publicRoute", {
    routeTableId: publicRouteTable.id,
    destinationCidrBlock: config.require('dest_cidr') + "/" + config.require('dest_mask'),
    gatewayId: internetgateway.id,
});

// const sg = new aws.ec2.SecurityGroup("my-security-group", {
//     vpcId: vpc.id,
//     ingress: [
//         {
//             protocol: "tcp",
//             fromPort: 80,
//             toPort: 80,
//             cidrBlocks: [config.require('dest_cidr') +"/" + config.require('dest_mask')]
//         },
//         {
//             protocol: "tcp",
//             fromPort: 433,
//             toPort: 433,
//             cidrBlocks: [config.require('dest_cidr') +"/" + config.require('dest_mask')]
//         },
//         {
//             protocol: "tcp",
//             fromPort: 22,
//             toPort: 22,
//             cidrBlocks: [config.require('dest_cidr') +"/" + config.require('dest_mask')]
//         },
//         {
//             protocol: "tcp",
//             fromPort: 3000,
//             toPort: 3000,
//             cidrBlocks: [config.require('dest_cidr') +"/" + config.require('dest_mask')]
//         }
//     ]
// });

// const ec2Instance = new aws.ec2.Instance("ec2Instance", {
//     ami: 'ami-06db4d78cb1d3bbf9',
//     instanceType: "t2.micro",
//     subnetId: selectedPublicSubnetId,
//     vpcSecurityGroupIds: [ sg.id ], // Reference the security group
//     // Enable EBS termination protection
//     rootBlockDevice: {
//         deleteOnTermination: true,
//     },  // Replace '0' with the index of the desired subnet
// });


