defmodule Guardian.Repo.ScheduledTask do
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :string, autogenerate: false}
  schema "scheduled_tasks" do
    field :group_folder, :string
    field :chat_jid, :string
    field :prompt, :string
    field :schedule_type, :string
    field :schedule_value, :string
    field :context_mode, :string, default: "isolated"
    field :next_run, :string
    field :last_run, :string
    field :last_result, :string
    field :status, :string, default: "active"
    field :created_at, :string
  end

  def changeset(task, attrs) do
    task
    |> cast(attrs, [
      :id,
      :group_folder,
      :chat_jid,
      :prompt,
      :schedule_type,
      :schedule_value,
      :context_mode,
      :next_run,
      :last_run,
      :last_result,
      :status,
      :created_at
    ])
    |> validate_required([:id, :group_folder, :chat_jid, :prompt, :schedule_type, :schedule_value, :created_at])
    |> validate_inclusion(:schedule_type, ["cron", "interval", "once"])
    |> validate_inclusion(:context_mode, ["group", "isolated"])
    |> validate_inclusion(:status, ["active", "paused", "completed"])
  end
end
