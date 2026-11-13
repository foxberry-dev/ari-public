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

module "workspace" {
  source       = "http://nexus-cache.nexus.svc.cluster.local:8084/repository/workspace-kit/d18dbc50c333332eb986ec741337c19072a98e2c50d0c54342db26194ade4efb.tar.gz?checksum=sha256:d18dbc50c333332eb986ec741337c19072a98e2c50d0c54342db26194ade4efb"
  image        = "registry.foxberry.dev/foxberry/workspace-kit@sha256:d3043cfe4386989fce18007938bea8959790330a112f495a67ec26985ecc1543"
  runner_image = "registry.foxberry.dev/foxberry/paperclip@sha256:636530bf3f757d74ea1574ccfa5b76350431f2acd4df2b1a41255c3343824907"
  project = {
    name       = "ari"
    repository = "https://github.com/foxberry-dev/ari.git"
    pre_push   = "sh .githooks/pre-push"
    startup    = file("${path.module}/startup.sh")
  }
}
