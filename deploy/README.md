# Staging deploy scripts

These three scripts run on the staging EC2 host as the forced command behind
the `ci-deploy` SSH key (see `waslproperty-infra/modules/ec2/templates/user_data.sh.tftpl`).
They are **not** deployed by Terraform or by the GitHub Actions workflow —
they were previously maintained only on the host itself with no copy in
version control. This directory is now the source of truth; pushing a
change here does nothing by itself and must be synced to the host out of
band (e.g. `aws ssm send-command` with `AWS-RunShellScript`, writing each
file to its path under `/opt/waslproperty/shared/`, owned by `root`, mode
`750`, group `ci-deploy`).

- `deploy-dispatch.sh` → `/opt/waslproperty/shared/deploy-dispatch.sh`
- `deploy-backend.sh` → `/opt/waslproperty/shared/deploy-backend.sh`
- `deploy-frontend.sh` → `/opt/waslproperty/shared/deploy-frontend.sh`

After syncing a change, confirm `/opt/waslproperty/shared/backend.env`
still exists and was not touched (it is never written by Terraform or by
these scripts) and that file permissions match the above.
