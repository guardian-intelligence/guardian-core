defmodule Guardian.Repo.TaskRunLog do
  use Ecto.Schema
  import Ecto.Changeset

  schema "task_run_logs" do
    field :task_id, :string
    field :run_at, :string
    field :duration_ms, :integer
    field :status, :string
    field :result, :string
    field :error, :string
  end

  def changeset(log, attrs) do
    log
    |> cast(attrs, [:task_id, :run_at, :duration_ms, :status, :result, :error])
    |> validate_required([:task_id, :run_at, :duration_ms, :status])
    |> validate_inclusion(:status, ["success", "error"])
  end
end
