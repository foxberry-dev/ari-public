terraform {
  required_providers {
    coder = {
      source  = "coder/coder"
      version = "2.20.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "3.5.0"
    }
  }
}

provider "coder" {}
provider "kubernetes" {}

data "coder_workspace" "me" {}
data "coder_workspace_owner" "me" {}

module "workspace" {
  source       = "http://nexus-cache.nexus.svc.cluster.local:8084/repository/workspace-kit/66790c31c2e2e9c2626d5d0eb4fe224274c7504e5cad56d92ab0169ce0daac94.tar.gz?checksum=sha256:66790c31c2e2e9c2626d5d0eb4fe224274c7504e5cad56d92ab0169ce0daac94"
  image        = "registry.foxberry.dev/foxberry/workspace-kit@sha256:daae9bc14a43d4d500ddbd12dd56d905a650627432e3c67bc663572017052974"
  runner_image = "registry.foxberry.dev/foxberry/paperclip@sha256:636530bf3f757d74ea1574ccfa5b76350431f2acd4df2b1a41255c3343824907"
  apps         = { web = 5175 }
  project = {
    name       = "ari"
    repository = "https://github.com/foxberry-dev/ari.git"
    pre_push   = "sh .githooks/pre-push"
    startup    = file("${path.module}/startup.sh")
    env = {
      ARI_DEV_HOST = "web--main--${data.coder_workspace.me.name}--${data.coder_workspace_owner.me.name}.coder.foxberry.dev"
    }
  }
}
